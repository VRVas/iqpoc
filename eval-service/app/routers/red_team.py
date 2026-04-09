"""Red teaming endpoints - taxonomy-based adversarial testing.

Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/run-ai-red-teaming-cloud?tabs=python

Workflow (per MS Learn):
1. Create an AI red team (eval) with evaluators like prohibited_actions, task_adherence, sensitive_data_leakage
2. Create (or update) an evaluation taxonomy for the target agent + risk categories
3. Create a run in the red team with attack strategies and the taxonomy source

Note: Red team evals live in a separate 'redteam' namespace in Foundry.
client.evals.list() does NOT return them — they're only accessible via
client.evals.runs.retrieve(run_id, eval_id) with known IDs.
We store run metadata locally to enable listing.

Attack strategies supported: "Flip", "Base64", "IndirectJailbreak"
Risk categories: PROHIBITED_ACTIONS (from azure.ai.projects.models.RiskCategory)
"""

import logging
import time
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_openai_client, get_project_client, get_settings
from app.services.eval_service import poll_eval_run

router = APIRouter()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Red team run registry — tracks runs since Foundry's evals.list() excludes them
# ---------------------------------------------------------------------------
_red_team_runs: list[dict] = []


class RedTeamRequest(BaseModel):
    name: str = "Red Team Scan"
    agent_name: str
    agent_version: Optional[str] = None
    risk_categories: list[str] = Field(
        default_factory=lambda: ["ProhibitedActions"]
    )
    attack_strategies: list[str] = Field(
        default_factory=lambda: ["Flip", "Base64", "IndirectJailbreak"]
    )
    num_turns: int = 5
    model_deployment: Optional[str] = None
    evaluators: list[str] = Field(
        default_factory=lambda: ["prohibited_actions", "task_adherence", "sensitive_data_leakage"]
    )


class RedTeamResponse(BaseModel):
    eval_id: str
    run_id: str
    taxonomy_id: Optional[str] = None
    status: str
    estimated_duration_minutes: int


@router.post("/run", response_model=RedTeamResponse)
async def run_red_team(req: RedTeamRequest):
    """Trigger an AI Red Teaming run against a Foundry agent.

    Follows the taxonomy-based flow from MS Learn:
    1. Create eval with red team evaluators
    2. Create taxonomy for agent + risk categories
    3. Create run with attack strategies + taxonomy source

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/run-ai-red-teaming-cloud?tabs=python
    """
    settings = get_settings()
    model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        client = get_openai_client()
        project_client = get_project_client()

        # Step 1: Create the red team eval with evaluators
        data_source_config = {"type": "azure_ai_source", "scenario": "red_team"}

        testing_criteria = []
        for evaluator_name in req.evaluators:
            tc = {
                "type": "azure_ai_evaluator",
                "name": evaluator_name,
                "evaluator_name": f"builtin.{evaluator_name}",
                "evaluator_version": "1",
            }
            if evaluator_name in ("task_adherence", "intent_resolution", "task_completion"):
                tc["initialization_parameters"] = {"deployment_name": model}
            testing_criteria.append(tc)

        eval_obj = client.evals.create(
            name=req.name,
            data_source_config=data_source_config,
            testing_criteria=testing_criteria,
        )
        logger.info("Created red team eval: %s", eval_obj.id)

        # Step 2: Create taxonomy for the agent
        from azure.ai.projects.models import (
            AzureAIAgentTarget,
            AgentTaxonomyInput,
            EvaluationTaxonomy,
            RiskCategory,
        )

        target = AzureAIAgentTarget(name=req.agent_name)
        if req.agent_version:
            target = AzureAIAgentTarget(name=req.agent_name, version=req.agent_version)

        risk_category_map = {
            "ProhibitedActions": RiskCategory.PROHIBITED_ACTIONS,
        }
        risk_cats = [risk_category_map.get(rc, rc) for rc in req.risk_categories]

        taxonomy = project_client.beta.evaluation_taxonomies.create(
            name=req.agent_name,
            body=EvaluationTaxonomy(
                description=f"Taxonomy for red teaming {req.agent_name}",
                taxonomy_input=AgentTaxonomyInput(
                    risk_categories=risk_cats,
                    target=target,
                ),
            ),
        )
        taxonomy_file_id = taxonomy.id
        logger.info("Created taxonomy: %s", taxonomy_file_id)

        # Step 3: Create run with attack strategies + taxonomy
        data_source = {
            "type": "azure_ai_red_team",
            "item_generation_params": {
                "type": "red_team_taxonomy",
                "attack_strategies": req.attack_strategies,
                "num_turns": req.num_turns,
                "source": {"type": "file_id", "id": taxonomy_file_id},
            },
            "target": target.as_dict(),
        }

        eval_run = client.evals.runs.create(
            eval_id=eval_obj.id,
            name=f"{req.name} run",
            data_source=data_source,
        )
        logger.info("Created red team run: %s (status: %s)", eval_run.id, eval_run.status)

        # Track the run locally since evals.list() won't return red team evals
        _red_team_runs.append({
            "eval_id": eval_obj.id,
            "run_id": eval_run.id,
            "name": req.name,
            "agent_name": req.agent_name,
            "status": eval_run.status,
            "created_at": int(time.time()),
            "attack_strategies": req.attack_strategies,
            "num_turns": req.num_turns,
            "taxonomy_id": taxonomy_file_id,
        })

        return RedTeamResponse(
            eval_id=eval_obj.id,
            run_id=eval_run.id,
            taxonomy_id=taxonomy_file_id,
            status=eval_run.status,
            estimated_duration_minutes=max(5, req.num_turns * 2),
        )

    except Exception as e:
        logger.exception("Red team run failed")
        raise HTTPException(500, str(e))


@router.get("/status/{run_id}")
async def get_red_team_status(run_id: str, eval_id: str):
    """Poll red team run status and get results.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/run-ai-red-teaming-cloud?tabs=python#get-a-red-teaming-run-by-id
    """
    try:
        result = poll_eval_run(eval_id, run_id, timeout_seconds=5)
        return result
    except Exception as e:
        logger.exception("Red team status check failed")
        raise HTTPException(500, str(e))


@router.get("/list")
async def list_red_team_runs():
    """List all tracked red team runs.

    Since Foundry's evals.list() doesn't return red team evals (they live
    in a separate 'redteam' namespace), we track them locally on creation.
    This endpoint returns the tracked runs with their current status.
    """
    results = []
    client = None

    for run_meta in reversed(_red_team_runs):  # newest first
        run_data = {
            "eval_id": run_meta["eval_id"],
            "run_id": run_meta["run_id"],
            "name": run_meta["name"],
            "agent_name": run_meta.get("agent_name", ""),
            "type": "red_team",
            "status": run_meta.get("status", "unknown"),
            "created_at": run_meta.get("created_at"),
            "attack_strategies": run_meta.get("attack_strategies", []),
            "num_turns": run_meta.get("num_turns", 0),
            "result_counts": None,
            "report_url": None,
        }

        # Try to get latest status from Foundry
        try:
            if client is None:
                client = get_openai_client()
            run = client.evals.runs.retrieve(run_id=run_meta["run_id"], eval_id=run_meta["eval_id"])
            run_data["status"] = getattr(run, "status", "unknown")
            run_data["report_url"] = getattr(run, "report_url", None)
            if hasattr(run, "result_counts") and run.result_counts:
                run_data["result_counts"] = {
                    "total": getattr(run.result_counts, "total", 0),
                    "passed": getattr(run.result_counts, "passed", 0),
                    "failed": getattr(run.result_counts, "failed", 0),
                    "errored": getattr(run.result_counts, "errored", 0),
                }
        except Exception as e:
            logger.warning("Could not refresh status for red team run %s: %s", run_meta["run_id"], e)

        results.append(run_data)

    return {"runs": results, "total": len(results)}


@router.post("/register")
async def register_red_team_run(
    eval_id: str,
    run_id: str,
    name: str = "Red Team Scan",
    agent_name: str = "",
):
    """Manually register a red team run that was created outside our API.

    Since red team evals don't appear in evals.list(), this lets users
    add existing runs to the tracking list.
    """
    # Check it's not already tracked
    existing = [r for r in _red_team_runs if r["run_id"] == run_id]
    if existing:
        return {"status": "already_tracked", "run_id": run_id}

    _red_team_runs.append({
        "eval_id": eval_id,
        "run_id": run_id,
        "name": name,
        "agent_name": agent_name,
        "status": "unknown",
        "created_at": int(time.time()),
        "attack_strategies": [],
        "num_turns": 0,
    })

    return {"status": "registered", "eval_id": eval_id, "run_id": run_id}
