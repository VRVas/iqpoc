"""Response log management — stores and retrieves agent response IDs for evaluation.

Stores response metadata in Cosmos DB 'response-log' container for later
evaluation via the Agent Response Evaluation flow.

Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#agent-response-evaluation
     "Collect response IDs from your application's interactions"
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cosmos DB client (lazy init)
# ---------------------------------------------------------------------------

_cosmos_container = None


def _get_cosmos_container():
    """Lazy-init Cosmos DB container for response logs."""
    global _cosmos_container
    if _cosmos_container is not None:
        return _cosmos_container

    try:
        from azure.cosmos import CosmosClient
        from app.config import get_credential

        settings = get_settings()
        credential = get_credential()
        client = CosmosClient(settings.COSMOS_ENDPOINT, credential=credential)
        database = client.get_database_client(settings.COSMOS_DATABASE)
        _cosmos_container = database.get_container_client("response-log")
        logger.info("Cosmos DB response-log container initialized")
        return _cosmos_container
    except Exception as e:
        logger.warning("Cosmos DB unavailable — using in-memory fallback: %s", e)
        return None


# In-memory fallback when Cosmos is unavailable
_in_memory_logs: list[dict] = []


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class ResponseLogEntry(BaseModel):
    response_id: str
    conversation_id: Optional[str] = None
    agent_name: Optional[str] = None
    user_query: Optional[str] = None
    response_text: Optional[str] = None
    tool_calls: Optional[list[dict]] = None
    timestamp: Optional[str] = None
    has_kb_retrieval: bool = False
    has_mcp_call: bool = False
    loop_count: int = 0


class ResponseLogSummary(BaseModel):
    response_id: str
    agent_name: Optional[str] = None
    user_query: Optional[str] = None
    timestamp: str
    has_kb_retrieval: bool = False
    has_mcp_call: bool = False
    tool_count: int = 0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/log")
async def log_response(entry: ResponseLogEntry):
    """Log a response ID with metadata for later evaluation.

    Called by the Next.js agent response handler (fire-and-forget)
    after each completed agent interaction.
    """
    try:
        doc = {
            "id": str(uuid.uuid4()),
            "response_id": entry.response_id,
            "conversation_id": entry.conversation_id or "",
            "agent_name": entry.agent_name or "unknown",
            "user_query": (entry.user_query or "")[:2000],
            "response_text": (entry.response_text or "")[:5000],
            "tool_calls": entry.tool_calls or [],
            "timestamp": entry.timestamp or datetime.now(timezone.utc).isoformat(),
            "has_kb_retrieval": entry.has_kb_retrieval,
            "has_mcp_call": entry.has_mcp_call,
            "loop_count": entry.loop_count,
            "evaluated": False,
        }

        container = _get_cosmos_container()
        if container:
            container.upsert_item(doc)
            logger.info("Logged response %s to Cosmos", entry.response_id)
        else:
            _in_memory_logs.append(doc)
            # Keep only last 500 in memory
            if len(_in_memory_logs) > 500:
                _in_memory_logs.pop(0)
            logger.info("Logged response %s to memory (Cosmos unavailable)", entry.response_id)

        return {"status": "logged", "response_id": entry.response_id}

    except Exception as e:
        logger.warning("Failed to log response: %s", e)
        # Don't fail the API — this is non-critical
        return {"status": "error", "message": str(e)}


@router.get("/list")
async def list_responses(
    agent_name: Optional[str] = None,
    limit: int = 50,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    """List recent response logs for evaluation.

    Returns response IDs that can be submitted to the
    Agent Response Evaluation flow.

    Query params:
    - agent_name: filter by agent
    - limit: max results (default 50, max 200)
    - from_date: ISO datetime lower bound (e.g., 2026-04-01T00:00:00Z)
    - to_date: ISO datetime upper bound

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#collect-response-ids
    """
    try:
        container = _get_cosmos_container()
        if container:
            # Build query with optional filters
            conditions = []
            params = [{"name": "@limit", "value": min(limit, 200)}]

            if agent_name:
                conditions.append("c.agent_name = @agent_name")
                params.append({"name": "@agent_name", "value": agent_name})

            if from_date:
                conditions.append("c.timestamp >= @from_date")
                params.append({"name": "@from_date", "value": from_date})

            if to_date:
                conditions.append("c.timestamp <= @to_date")
                params.append({"name": "@to_date", "value": to_date})

            where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
            query = f"SELECT TOP @limit c.response_id, c.agent_name, c.user_query, c.timestamp, c.has_kb_retrieval, c.has_mcp_call, c.tool_calls FROM c{where_clause} ORDER BY c.timestamp DESC"

            items = list(container.query_items(
                query=query,
                parameters=params,
                enable_cross_partition_query=True,
            ))

            return {
                "responses": [
                    {
                        "response_id": item["response_id"],
                        "agent_name": item.get("agent_name"),
                        "user_query": (item.get("user_query") or "")[:200],
                        "timestamp": item.get("timestamp"),
                        "has_kb_retrieval": item.get("has_kb_retrieval", False),
                        "has_mcp_call": item.get("has_mcp_call", False),
                        "tool_count": len(item.get("tool_calls") or []),
                    }
                    for item in items
                ],
                "total": len(items),
                "source": "cosmos",
            }
        else:
            # In-memory fallback
            logs = _in_memory_logs.copy()
            if agent_name:
                logs = [l for l in logs if l.get("agent_name") == agent_name]
            if from_date:
                logs = [l for l in logs if l.get("timestamp", "") >= from_date]
            if to_date:
                logs = [l for l in logs if l.get("timestamp", "") <= to_date]
            logs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
            logs = logs[:limit]

            return {
                "responses": [
                    {
                        "response_id": l["response_id"],
                        "agent_name": l.get("agent_name"),
                        "user_query": (l.get("user_query") or "")[:200],
                        "timestamp": l.get("timestamp"),
                        "has_kb_retrieval": l.get("has_kb_retrieval", False),
                        "has_mcp_call": l.get("has_mcp_call", False),
                        "tool_count": len(l.get("tool_calls") or []),
                    }
                    for l in logs
                ],
                "total": len(logs),
                "source": "memory",
            }

    except Exception as e:
        logger.exception("Failed to list responses")
        raise HTTPException(500, str(e))


@router.get("/count")
async def count_responses(agent_name: Optional[str] = None):
    """Get count of stored response logs."""
    try:
        container = _get_cosmos_container()
        if container:
            query = "SELECT VALUE COUNT(1) FROM c"
            params = []
            if agent_name:
                query = "SELECT VALUE COUNT(1) FROM c WHERE c.agent_name = @agent_name"
                params = [{"name": "@agent_name", "value": agent_name}]

            result = list(container.query_items(
                query=query,
                parameters=params,
                enable_cross_partition_query=True,
            ))
            return {"count": result[0] if result else 0, "source": "cosmos"}
        else:
            logs = _in_memory_logs
            if agent_name:
                logs = [l for l in logs if l.get("agent_name") == agent_name]
            return {"count": len(logs), "source": "memory"}
    except Exception as e:
        logger.exception("Failed to count responses")
        raise HTTPException(500, str(e))


@router.post("/configure-ttl")
async def configure_ttl(ttl_seconds: int = 7776000):
    """Configure TTL (Time-to-Live) on the response-log Cosmos container.

    Default: 7776000 seconds = 90 days.
    Set to -1 to disable TTL (keep forever).
    Set to 0 to use per-item TTL only.

    Cosmos DB TTL automatically expires documents after the specified duration,
    preventing unbounded growth of response logs.

    Ref: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-time-to-live
    """
    try:
        container = _get_cosmos_container()
        if not container:
            return {"status": "skipped", "reason": "Cosmos DB not available (using in-memory)"}

        # Update container's default TTL policy
        # Per Cosmos docs: defaultTtl > 0 means auto-expire after N seconds
        from azure.cosmos import PartitionKey
        database = container.client_connection.get_database_client(get_settings().COSMOS_DATABASE)
        database.replace_container(
            container=container,
            partition_key=PartitionKey(path="/agent_name"),
            default_ttl=ttl_seconds,
        )

        ttl_days = ttl_seconds // 86400 if ttl_seconds > 0 else ("disabled" if ttl_seconds == -1 else "per-item")
        logger.info("Configured TTL on response-log: %s seconds (%s days)", ttl_seconds, ttl_days)

        return {
            "status": "configured",
            "ttl_seconds": ttl_seconds,
            "ttl_days": ttl_days,
        }

    except Exception as e:
        logger.exception("Failed to configure TTL")
        raise HTTPException(500, str(e))
