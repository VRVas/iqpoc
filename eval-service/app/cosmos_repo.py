"""Cosmos DB repository for evaluation run metadata.

Replaces the in-memory `_red_team_runs` list and on-the-fly Foundry calls in
`history.py`. All evaluation triggers upsert a record here on creation. A
background poller refreshes pending runs by retrieving Foundry status.

Schema (container `eval-results`, partition key `/evalId`):
  - id: run_id (Cosmos document ID, unique across all runs)
  - evalId: Foundry eval ID (partition key)
  - runId: Foundry run ID (== id)
  - type: "evaluation" | "red_team" | "continuous"
  - category: "batch" | "agent_target" | "by_response_ids" | "synthetic"
              | "model_target" | "red_team" | "continuous"
  - name: human-readable eval name
  - agentName: target agent name (nullable)
  - status: "pending" | "queued" | "in_progress" | "completed" | "failed" | "canceled"
  - createdAt: int (epoch seconds, for ORDER BY)
  - updatedAt: int (epoch seconds)
  - completedAt: int | null
  - evaluators: list[str]
  - modelDeployment: str | null
  - resultCounts: {total, passed, failed, errored} | null
  - metrics: list[{name, passed, failed, passRate}] | null
  - reportUrl: str | null
  - attackStrategies: list[str] | null  (red team only)
  - numTurns: int | null               (red team only)
  - taxonomyId: str | null             (red team only)
  - error: str | null
  - foundryRaw: dict | null            (last raw snapshot — for debug)

Refs:
  - Cosmos Python SDK: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/quickstart-python
  - Entra ID auth: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/security/how-to-grant-data-plane-role-based-access
  - SQL queries: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/getting-started
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from typing import Optional

from azure.cosmos import CosmosClient, PartitionKey, exceptions
from azure.cosmos.container import ContainerProxy

from app.config import get_credential, get_settings

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = {"completed", "failed", "canceled", "cancelled"}


def _now() -> int:
    return int(time.time())


class CosmosRepo:
    """Wrapper over the Cosmos NoSQL container `eval-results`."""

    def __init__(
        self,
        endpoint: str,
        database_name: str,
        container_name: str = "eval-results",
    ) -> None:
        # Per MS Learn: DefaultAzureCredential picks up AZURE_CLIENT_ID for UAMI
        # or falls back to other credential chain entries.
        self._client = CosmosClient(url=endpoint, credential=get_credential())
        self._db = self._client.get_database_client(database_name)
        self._container: ContainerProxy = self._db.get_container_client(container_name)

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    def upsert_eval(
        self,
        *,
        eval_id: str,
        run_id: str,
        type: str,
        category: str,
        name: str = "",
        agent_name: Optional[str] = None,
        status: str = "pending",
        evaluators: Optional[list[str]] = None,
        model_deployment: Optional[str] = None,
        attack_strategies: Optional[list[str]] = None,
        num_turns: Optional[int] = None,
        taxonomy_id: Optional[str] = None,
        created_at: Optional[int] = None,
    ) -> dict:
        """Upsert a new eval record at trigger time. Status starts as `pending`
        or whatever the caller already knows (Foundry usually returns `queued`).
        """
        now = _now()
        doc = {
            "id": run_id,
            "evalId": eval_id,
            "runId": run_id,
            "type": type,
            "category": category,
            "name": name,
            "agentName": agent_name,
            "status": status,
            "createdAt": created_at if created_at is not None else now,
            "updatedAt": now,
            "completedAt": now if status in TERMINAL_STATUSES else None,
            "evaluators": evaluators or [],
            "modelDeployment": model_deployment,
            "resultCounts": None,
            "metrics": None,
            "reportUrl": None,
            "attackStrategies": attack_strategies,
            "numTurns": num_turns,
            "taxonomyId": taxonomy_id,
            "error": None,
            "foundryRaw": None,
        }
        return self._container.upsert_item(doc)

    def update_from_foundry(
        self,
        *,
        eval_id: str,
        run_id: str,
        status: str,
        result_counts: Optional[dict] = None,
        metrics: Optional[list[dict]] = None,
        report_url: Optional[str] = None,
        error: Optional[str] = None,
        foundry_raw: Optional[dict] = None,
    ) -> Optional[dict]:
        """Refresh a known run with the latest Foundry status. Skip if doc
        not present (poller drops orphan IDs)."""
        try:
            doc = self._container.read_item(item=run_id, partition_key=eval_id)
        except exceptions.CosmosResourceNotFoundError:
            return None

        now = _now()
        doc["status"] = status
        doc["updatedAt"] = now
        if status in TERMINAL_STATUSES and doc.get("completedAt") is None:
            doc["completedAt"] = now
        if result_counts is not None:
            doc["resultCounts"] = result_counts
        if metrics is not None:
            doc["metrics"] = metrics
        if report_url is not None:
            doc["reportUrl"] = report_url
        if error is not None:
            doc["error"] = error
        if foundry_raw is not None:
            doc["foundryRaw"] = foundry_raw
        return self._container.upsert_item(doc)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    def get_run(self, *, eval_id: str, run_id: str) -> Optional[dict]:
        try:
            return self._container.read_item(item=run_id, partition_key=eval_id)
        except exceptions.CosmosResourceNotFoundError:
            return None

    def list_runs(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        type: Optional[str] = None,
        category: Optional[str] = None,
        agent_name: Optional[str] = None,
        status: Optional[str] = None,
        date_from: Optional[int] = None,
        date_to: Optional[int] = None,
        order_by: str = "createdAt",
        order: str = "desc",
    ) -> tuple[list[dict], int]:
        """List runs with pagination + filters. Returns (items, totalCount).

        Cross-partition query (low volume — < 10k docs expected).
        """
        # Whitelist sortable columns to prevent injection
        SORT_WHITELIST = {
            "createdAt": "c.createdAt",
            "completedAt": "c.completedAt",
            "updatedAt": "c.updatedAt",
            "resultCounts.total": "c.resultCounts.total",
        }
        sort_col = SORT_WHITELIST.get(order_by, "c.createdAt")
        sort_dir = "DESC" if (order or "").lower() == "desc" else "ASC"

        where_clauses: list[str] = []
        params: list[dict] = []
        if type:
            where_clauses.append("c.type = @type")
            params.append({"name": "@type", "value": type})
        if category:
            where_clauses.append("c.category = @category")
            params.append({"name": "@category", "value": category})
        if agent_name:
            where_clauses.append("c.agentName = @agentName")
            params.append({"name": "@agentName", "value": agent_name})
        if status:
            where_clauses.append("c.status = @status")
            params.append({"name": "@status", "value": status})
        if date_from is not None:
            where_clauses.append("c.createdAt >= @dateFrom")
            params.append({"name": "@dateFrom", "value": date_from})
        if date_to is not None:
            where_clauses.append("c.createdAt <= @dateTo")
            params.append({"name": "@dateTo", "value": date_to})

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        # Page query
        page_params = params + [
            {"name": "@offset", "value": int(offset)},
            {"name": "@limit", "value": int(limit)},
        ]
        page_sql = (
            f"SELECT * FROM c {where_sql} "
            f"ORDER BY {sort_col} {sort_dir} OFFSET @offset LIMIT @limit"
        )
        items = list(
            self._container.query_items(
                query=page_sql,
                parameters=page_params,
                enable_cross_partition_query=True,
            )
        )

        # Total count
        count_sql = f"SELECT VALUE COUNT(1) FROM c {where_sql}"
        count_iter = self._container.query_items(
            query=count_sql,
            parameters=params,
            enable_cross_partition_query=True,
        )
        total = next(iter(count_iter), 0)

        return items, int(total)

    def list_pending(self, *, max_items: int = 200) -> list[dict]:
        """Return non-terminal runs for the background poller."""
        sql = (
            "SELECT * FROM c WHERE NOT IS_DEFINED(c.status) "
            "OR c.status NOT IN ('completed', 'failed', 'canceled', 'cancelled') "
            "ORDER BY c.updatedAt ASC"
        )
        items = list(
            self._container.query_items(
                query=sql,
                enable_cross_partition_query=True,
                max_item_count=max_items,
            )
        )
        return items[:max_items]


# ---------------------------------------------------------------------------
# Singleton accessor — first call lazy-initializes the client.
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_cosmos_repo() -> CosmosRepo:
    settings = get_settings()
    container_name = "eval-results"
    # Allow override via env var (set on the Container App)
    import os
    container_name = os.environ.get("COSMOS_CONTAINER_EVAL_RESULTS", container_name)
    return CosmosRepo(
        endpoint=settings.COSMOS_ENDPOINT,
        database_name=settings.COSMOS_DATABASE,
        container_name=container_name,
    )


def safe_get_cosmos_repo() -> Optional[CosmosRepo]:
    """Return repo or None if Cosmos is misconfigured / unreachable.

    Used by trigger handlers so that a Cosmos outage does not block evaluation
    creation. The background poller will still try later, but a missing record
    means it won't appear in the history list — which is acceptable degraded
    behaviour vs. failing the user's request.
    """
    try:
        return get_cosmos_repo()
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("Cosmos repo unavailable: %s", e)
        return None
