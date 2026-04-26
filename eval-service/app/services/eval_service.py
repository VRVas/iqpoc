"""Core evaluation service — wraps Foundry Evals API.

Grounded in: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python

Key patterns from docs:
- AIProjectClient → get_openai_client() → client.evals.create() + client.evals.runs.create()
- data_source_config: DataSourceConfigCustom for dataset/inline, {"type": "azure_ai_source", "scenario": "responses"} for response IDs
- testing_criteria: list of {"type": "azure_ai_evaluator", "evaluator_name": "builtin.X", "data_mapping": {...}}
- data_source types: jsonl, azure_ai_responses, azure_ai_target_completions, azure_ai_synthetic_data_gen_preview
"""

import logging
import time
from typing import Optional

from openai.types.eval_create_params import DataSourceConfigCustom
from openai.types.evals.create_eval_jsonl_run_data_source_param import (
    CreateEvalJSONLRunDataSourceParam,
    SourceFileContent,
    SourceFileContentContent,
)

from app.config import get_openai_client, get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Evaluator Registry — maps short names to builtin evaluator names and their
# required data_mapping fields.
#
# Each evaluator has a "modes" list indicating which eval modes it works in:
#   - "dataset": inline/uploaded data with pre-computed response text
#   - "agent_target": Foundry sends queries to agent (output_text may be empty
#     for function-calling agents — only output_items available)
#   - "response_ids": evaluate specific response IDs (full responses)
#
# Evaluators that need context, ground_truth, or tool_definitions are excluded
# from agent_target mode because those fields aren't available.
#
# Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/built-in-evaluators
# ---------------------------------------------------------------------------

EVALUATOR_REGISTRY = {
    # ── Quality (need response text → NOT agent_target with func tools, but OK for synthetic) ──
    "coherence": {
        "evaluator_name": "builtin.coherence",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "quality",
        "modes": ["dataset", "response_ids", "synthetic"],
    },
    "fluency": {
        "evaluator_name": "builtin.fluency",
        "requires_model": True,
        "data_mapping": {"response": "{{item.response}}"},
        "category": "quality",
        "modes": ["dataset", "response_ids", "synthetic"],
    },
    # ── RAG (need context/ground_truth → dataset only, or response_ids) ──
    "groundedness": {
        "evaluator_name": "builtin.groundedness",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}", "context": "{{item.context}}"},
        "category": "rag",
        "modes": ["dataset"],
        "requires_field": "context",
    },
    "groundedness_pro": {
        "evaluator_name": "builtin.groundedness_pro",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}", "context": "{{item.context}}"},
        "category": "rag",
        "modes": ["dataset"],
        "requires_field": "context",
    },
    "relevance": {
        "evaluator_name": "builtin.relevance",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "rag",
        "modes": ["dataset", "response_ids", "synthetic"],
    },
    "retrieval": {
        "evaluator_name": "builtin.retrieval",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "context": "{{item.context}}"},
        "category": "rag",
        "modes": ["dataset"],
        "requires_field": "context",
    },
    "response_completeness": {
        "evaluator_name": "builtin.response_completeness",
        "requires_model": True,
        "data_mapping": {"ground_truth": "{{item.ground_truth}}", "response": "{{item.response}}"},
        "category": "rag",
        "modes": ["dataset"],
        "requires_field": "ground_truth",
    },
    # ── Safety (work in all modes — accept empty text gracefully) ────────
    "violence": {
        "evaluator_name": "builtin.violence",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "safety",
        "modes": ["dataset", "agent_target", "response_ids", "synthetic"],
    },
    "hate_unfairness": {
        "evaluator_name": "builtin.hate_unfairness",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "safety",
        "modes": ["dataset", "agent_target", "response_ids", "synthetic"],
    },
    "sexual": {
        "evaluator_name": "builtin.sexual",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "safety",
        "modes": ["dataset", "agent_target", "response_ids", "synthetic"],
    },
    "self_harm": {
        "evaluator_name": "builtin.self_harm",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "safety",
        "modes": ["dataset", "agent_target", "response_ids", "synthetic"],
    },
    "protected_material": {
        "evaluator_name": "builtin.protected_material",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "safety",
        "modes": ["dataset", "agent_target", "response_ids", "synthetic"],
    },
    "indirect_attack": {
        "evaluator_name": "builtin.indirect_attack",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "safety",
        "modes": ["dataset", "agent_target", "response_ids", "synthetic"],
    },
    "code_vulnerability": {
        "evaluator_name": "builtin.code_vulnerability",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}"},
        "category": "safety",
        "modes": ["dataset", "response_ids", "synthetic"],
    },
    "ungrounded_attributes": {
        "evaluator_name": "builtin.ungrounded_attributes",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{item.response}}", "context": "{{item.context}}"},
        "category": "safety",
        "modes": ["dataset"],
        "requires_field": "context",
    },
    "prohibited_actions": {
        "evaluator_name": "builtin.prohibited_actions",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "safety",
        "uses_output_items": True,
        "red_team_only": True,
        "modes": [],
    },
    "sensitive_data_leakage": {
        "evaluator_name": "builtin.sensitive_data_leakage",
        "requires_model": False,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "safety",
        "uses_output_items": True,
        "red_team_only": True,
        "modes": [],
    },
    # ── Agent (use output_items → work in agent_target and response_ids) ─
    "task_adherence": {
        "evaluator_name": "builtin.task_adherence",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "agent",
        "uses_output_items": True,
        "modes": ["agent_target", "response_ids", "synthetic"],
    },
    "task_completion": {
        "evaluator_name": "builtin.task_completion",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "agent",
        "uses_output_items": True,
        "modes": ["agent_target", "response_ids", "synthetic"],
    },
    "intent_resolution": {
        "evaluator_name": "builtin.intent_resolution",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "agent",
        "uses_output_items": True,
        "modes": ["agent_target", "response_ids", "synthetic"],
    },
    "tool_call_accuracy": {
        "evaluator_name": "builtin.tool_call_accuracy",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "agent",
        "uses_output_items": True,
        "requires_tool_definitions": True,
        "modes": ["agent_target", "response_ids", "synthetic"],
    },
    "tool_selection": {
        "evaluator_name": "builtin.tool_selection",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "agent",
        "uses_output_items": True,
        "requires_tool_definitions": True,
        "modes": ["agent_target", "response_ids", "synthetic"],
    },
    "tool_input_accuracy": {
        "evaluator_name": "builtin.tool_input_accuracy",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "agent",
        "uses_output_items": True,
        "requires_tool_definitions": True,
        "modes": ["agent_target", "response_ids", "synthetic"],
    },
    "tool_output_utilization": {
        "evaluator_name": "builtin.tool_output_utilization",
        "requires_model": True,
        "data_mapping": {"query": "{{item.query}}", "response": "{{sample.output_items}}"},
        "category": "agent",
        "uses_output_items": True,
        "requires_tool_definitions": True,
        "modes": ["agent_target", "response_ids", "synthetic"],
    },
    "tool_call_success": {
        "evaluator_name": "builtin.tool_call_success",
        "requires_model": True,
        "data_mapping": {"response": "{{sample.output_items}}"},
        "category": "agent",
        "uses_output_items": True,
        "modes": ["agent_target", "response_ids", "synthetic"],
    },
    # ── Textual similarity (needs ground_truth → dataset only) ───────────
    "f1_score": {
        "evaluator_name": "builtin.f1_score",
        "requires_model": False,
        "data_mapping": {"response": "{{item.response}}", "ground_truth": "{{item.ground_truth}}"},
        "category": "similarity",
        "modes": ["dataset"],
        "requires_field": "ground_truth",
    },
}


def build_testing_criteria(
    evaluator_names: list[str],
    model_deployment: str,
    use_sample_output: bool = False,
    eval_mode: str = "dataset",
    has_tool_definitions: bool = False,
) -> list[dict]:
    """Build testing_criteria list from evaluator short names.

    Args:
        evaluator_names: List of evaluator short names (e.g., ["coherence", "violence"])
        model_deployment: Model deployment name for AI-assisted evaluators
        use_sample_output: Whether to use {{sample.output_text}} instead of {{item.response}}
        eval_mode: One of "dataset", "agent_target", "response_ids" — filters incompatible evaluators
        has_tool_definitions: Whether tool_definitions are available in the test data.
            When True, tool evaluators get "tool_definitions": "{{item.tool_definitions}}" in data_mapping.
            Per MS Learn: tool_call_accuracy, tool_selection, tool_input_accuracy, tool_output_utilization
            all require tool_definitions.
            Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators#tool-definitions-format

    When use_sample_output is True (agent-target or synthetic eval),
    replace {{item.response}} with {{sample.output_text}} for non-agent evaluators.
    Agent evaluators already use {{sample.output_items}}.
    """
    criteria = []
    skipped = []
    for name in evaluator_names:
        if name not in EVALUATOR_REGISTRY:
            logger.warning("Unknown evaluator '%s', skipping", name)
            skipped.append(name)
            continue

        reg = EVALUATOR_REGISTRY[name]

        # Skip red-team-only evaluators
        if reg.get("red_team_only"):
            logger.info("Skipping red-team-only evaluator '%s'", name)
            skipped.append(name)
            continue

        # Skip evaluators not compatible with the current eval mode
        modes = reg.get("modes", [])
        if modes and eval_mode not in modes:
            logger.info("Skipping evaluator '%s' — not compatible with '%s' mode (supports: %s)", name, eval_mode, modes)
            skipped.append(name)
            continue

        entry: dict = {
            "type": "azure_ai_evaluator",
            "name": name,
            "evaluator_name": reg["evaluator_name"],
        }

        # Data mapping
        mapping = dict(reg["data_mapping"])
        if use_sample_output and not reg.get("uses_output_items"):
            # For agent-target evals, replace item.response with sample.output_text
            for k, v in mapping.items():
                if v == "{{item.response}}":
                    mapping[k] = "{{sample.output_text}}"
        entry["data_mapping"] = mapping
        # Add tool_definitions to data mapping for tool evaluators when available
        # Per MS Learn: tool_call_accuracy, tool_selection, tool_input_accuracy,
        # tool_output_utilization all require tool_definitions field
        if has_tool_definitions and reg.get("requires_tool_definitions"):
            entry["data_mapping"]["tool_definitions"] = "{{item.tool_definitions}}"
        # Model deployment for AI-assisted evaluators
        if reg["requires_model"]:
            entry["initialization_parameters"] = {"deployment_name": model_deployment}

        criteria.append(entry)

    if skipped:
        logger.info("Skipped %d evaluators for '%s' mode: %s", len(skipped), eval_mode, skipped)
    logger.info("Built %d testing criteria for '%s' mode", len(criteria), eval_mode)

    return criteria


# ---------------------------------------------------------------------------
# Evaluation Run Creators
# ---------------------------------------------------------------------------


def create_eval_and_run_dataset(
    name: str,
    items: list[dict],
    evaluator_names: list[str],
    model_deployment: str,
) -> dict:
    """Create eval + run on inline data (dataset evaluation).

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#dataset-evaluation
    """
    client = get_openai_client()

    # Determine schema from items
    schema_props = {}
    for key in items[0]:
        schema_props[key] = {"type": "string"}

    data_source_config = DataSourceConfigCustom(
        type="custom",
        item_schema={
            "type": "object",
            "properties": schema_props,
            "required": list(items[0].keys()),
        },
    )

    # Check if items contain tool_definitions (injected by frontend)
    has_tool_defs = "tool_definitions" in items[0]
    testing_criteria = build_testing_criteria(
        evaluator_names, model_deployment, eval_mode="dataset",
        has_tool_definitions=has_tool_defs,
    )

    eval_obj = client.evals.create(
        name=name,
        data_source_config=data_source_config,
        testing_criteria=testing_criteria,
    )
    logger.info("Created eval: %s", eval_obj.id)

    # Build inline file_content source
    source = SourceFileContent(
        type="file_content",
        content=[SourceFileContentContent(item=item) for item in items],
    )

    eval_run = client.evals.runs.create(
        eval_id=eval_obj.id,
        name=f"{name} run",
        data_source=CreateEvalJSONLRunDataSourceParam(
            type="jsonl",
            source=source,
        ),
    )
    logger.info("Created eval run: %s (status: %s)", eval_run.id, eval_run.status)

    return {"eval_id": eval_obj.id, "run_id": eval_run.id, "status": eval_run.status}


def create_eval_and_run_response_ids(
    name: str,
    response_ids: list[str],
    evaluator_names: list[str],
    model_deployment: str,
) -> dict:
    """Evaluate specific Foundry response IDs.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#agent-response-evaluation
    """
    client = get_openai_client()

    data_source_config = {"type": "azure_ai_source", "scenario": "responses"}

    testing_criteria = build_testing_criteria(evaluator_names, model_deployment, eval_mode="response_ids")
    # For response-ID eval, remove data_mapping since schema is auto-inferred
    # Per MS Learn: azure_ai_responses retrieves the full conversation from the response ID
    for tc in testing_criteria:
        if "data_mapping" in tc:
            del tc["data_mapping"]

    eval_obj = client.evals.create(
        name=name,
        data_source_config=data_source_config,
        testing_criteria=testing_criteria,
    )
    logger.info("Created eval (response IDs): %s", eval_obj.id)

    data_source = {
        "type": "azure_ai_responses",
        "item_generation_params": {
            "type": "response_retrieval",
            "data_mapping": {"response_id": "{{item.resp_id}}"},
            "source": {
                "type": "file_content",
                "content": [{"item": {"resp_id": rid}} for rid in response_ids],
            },
        },
    }

    eval_run = client.evals.runs.create(
        eval_id=eval_obj.id,
        name=f"{name} run",
        data_source=data_source,
    )
    logger.info("Created eval run (response IDs): %s", eval_run.id)

    return {"eval_id": eval_obj.id, "run_id": eval_run.id, "status": eval_run.status}


def create_eval_and_run_agent_target(
    name: str,
    agent_name: str,
    agent_version: Optional[str],
    queries: list[dict],
    evaluator_names: list[str],
    model_deployment: str,
    tool_definitions: Optional[list[dict]] = None,
) -> dict:
    """Send queries to an agent and evaluate responses.

    Args:
        tool_definitions: Optional list of tool definitions (OpenAI function-calling schema).
            When provided, tool evaluators can assess tool call quality.
            Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators#tool-definitions-format

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#agent-target-evaluation
    """
    import json as _json
    client = get_openai_client()

    # Build item schema — include tool_definitions if provided
    schema_props: dict = {"query": {"type": "string"}}
    if tool_definitions:
        schema_props["tool_definitions"] = {"type": "string"}

    data_source_config = DataSourceConfigCustom(
        type="custom",
        item_schema={
            "type": "object",
            "properties": schema_props,
            "required": ["query"],
        },
        include_sample_schema=True,
    )

    has_tool_defs = bool(tool_definitions)
    testing_criteria = build_testing_criteria(
        evaluator_names, model_deployment,
        use_sample_output=True, eval_mode="agent_target",
        has_tool_definitions=has_tool_defs,
    )

    eval_obj = client.evals.create(
        name=name,
        data_source_config=data_source_config,
        testing_criteria=testing_criteria,
    )
    logger.info("Created eval (agent target): %s", eval_obj.id)

    input_messages = {
        "type": "template",
        "template": [
            {"type": "message", "role": "user", "content": {"type": "input_text", "text": "{{item.query}}"}},
        ],
    }

    target = {"type": "azure_ai_agent", "name": agent_name}
    if agent_version:
        target["version"] = agent_version

    # Inject tool_definitions into each query item if provided
    query_items = []
    for q in queries:
        item = dict(q)
        if tool_definitions:
            item["tool_definitions"] = _json.dumps(tool_definitions)
        query_items.append(item)

    data_source = {
        "type": "azure_ai_target_completions",
        "source": {"type": "file_content", "content": [{"item": q} for q in query_items]},
        "input_messages": input_messages,
        "target": target,
    }

    eval_run = client.evals.runs.create(
        eval_id=eval_obj.id,
        name=f"{name} run",
        data_source=data_source,
    )
    logger.info("Created eval run (agent target): %s", eval_run.id)

    return {"eval_id": eval_obj.id, "run_id": eval_run.id, "status": eval_run.status}


def create_eval_and_run_synthetic(
    name: str,
    agent_name: str,
    agent_version: Optional[str],
    prompt: str,
    samples_count: int,
    evaluator_names: list[str],
    model_deployment: str,
    tool_definitions: Optional[list[dict]] = None,
) -> dict:
    """Generate synthetic queries and evaluate agent responses.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#synthetic-data-evaluation-preview
    """
    client = get_openai_client()

    data_source_config = {"type": "azure_ai_source", "scenario": "synthetic_data_gen_preview"}

    testing_criteria = build_testing_criteria(
        evaluator_names, model_deployment,
        use_sample_output=True, eval_mode="synthetic",
        has_tool_definitions=bool(tool_definitions),
    )

    eval_obj = client.evals.create(
        name=name,
        data_source_config=data_source_config,
        testing_criteria=testing_criteria,
    )
    logger.info("Created eval (synthetic): %s", eval_obj.id)

    target = {"type": "azure_ai_agent", "name": agent_name}
    if agent_version:
        target["version"] = agent_version

    data_source = {
        "type": "azure_ai_synthetic_data_gen_preview",
        "item_generation_params": {
            "type": "synthetic_data_gen_preview",
            "samples_count": samples_count,
            "prompt": prompt,
            "model_deployment_name": model_deployment,
        },
        "target": target,
    }

    eval_run = client.evals.runs.create(
        eval_id=eval_obj.id,
        name=f"{name} run",
        data_source=data_source,
    )
    logger.info("Created eval run (synthetic): %s", eval_run.id)

    return {"eval_id": eval_obj.id, "run_id": eval_run.id, "status": eval_run.status}


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


def poll_eval_run(eval_id: str, run_id: str, timeout_seconds: int = 60) -> dict:
    """Poll an eval run and return results.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#get-results
    """
    client = get_openai_client()
    start = time.time()

    while True:
        run = client.evals.runs.retrieve(run_id=run_id, eval_id=eval_id)

        if run.status in ("completed", "failed"):
            break

        if time.time() - start > timeout_seconds:
            return {
                "eval_id": eval_id,
                "run_id": run_id,
                "status": run.status,
                "message": "Still running — poll again later",
            }

        time.sleep(3)

    result = {
        "eval_id": eval_id,
        "run_id": run_id,
        "status": run.status,
        "report_url": getattr(run, "report_url", None),
        "result_counts": None,
        "per_evaluator": None,
        "items": [],
    }

    if run.status == "completed":
        # Get result counts
        if hasattr(run, "result_counts") and run.result_counts:
            result["result_counts"] = {
                "total": getattr(run.result_counts, "total", 0),
                "passed": getattr(run.result_counts, "passed", 0),
                "failed": getattr(run.result_counts, "failed", 0),
                "errored": getattr(run.result_counts, "errored", 0),
            }

        # Get per-evaluator results
        if hasattr(run, "per_testing_criteria_results") and run.per_testing_criteria_results:
            result["per_evaluator"] = [
                {
                    "name": r.testing_criteria if hasattr(r, "testing_criteria") else str(r),
                    "passed": getattr(r, "passed", 0),
                    "failed": getattr(r, "failed", 0),
                    "pass_rate": getattr(r, "pass_rate", 0),
                }
                for r in run.per_testing_criteria_results
            ]

        # Get individual output items (all — frontend handles pagination)
        try:
            output_items = list(client.evals.runs.output_items.list(run_id=run_id, eval_id=eval_id))
            for item in output_items:
                result["items"].append({
                    "id": getattr(item, "id", ""),
                    "status": getattr(item, "status", ""),
                    "datasource_item": getattr(item, "datasource_item", {}),
                    "results": getattr(item, "results", []),
                })
        except Exception as e:
            logger.warning("Could not fetch output items: %s", e)

    return result
