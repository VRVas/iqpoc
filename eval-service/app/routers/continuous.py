"""Continuous evaluation rule management.

Ref: https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard?tabs=python#set-up-continuous-evaluation
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_openai_client, get_project_client, get_settings
from app.services.eval_service import EVALUATOR_REGISTRY

router = APIRouter()
logger = logging.getLogger(__name__)


class ContinuousEvalRequest(BaseModel):
    rule_id: str = "default-continuous-rule"
    display_name: str = "Continuous Evaluation Rule"
    agent_name: str
    evaluators: list[str] = Field(default_factory=lambda: ["violence", "coherence"])
    model_deployment: Optional[str] = None
    max_hourly_runs: int = 100
    enabled: bool = True


class ContinuousEvalResponse(BaseModel):
    rule_id: str
    status: str
    agent_name: str
    evaluators: list[str]
    max_hourly_runs: int


@router.post("/configure", response_model=ContinuousEvalResponse)
async def configure_continuous_eval(req: ContinuousEvalRequest):
    """Create or update a continuous evaluation rule for an agent.

    This uses the Foundry SDK's evaluation_rules API to create rules that
    automatically evaluate sampled agent responses in production.
    """
    settings = get_settings()
    model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        client = get_openai_client()
        project_client = get_project_client()

        # 1. Create the eval definition with the selected evaluators
        # Per MS Learn, continuous evaluation uses azure_ai_source with "responses" scenario
        # and does NOT need data_mapping (schema auto-inferred from stored responses)
        # Ref: https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard?tabs=python#create-a-continuous-evaluation-rule
        data_source_config = {"type": "azure_ai_source", "scenario": "responses"}
        testing_criteria = []
        for name in req.evaluators:
            reg = EVALUATOR_REGISTRY.get(name)
            tc = {
                "type": "azure_ai_evaluator",
                "name": name,
                "evaluator_name": reg["evaluator_name"] if reg else f"builtin.{name}",
            }
            # Use the registry to determine if model deployment is needed
            if reg and reg.get("requires_model"):
                tc["initialization_parameters"] = {"deployment_name": model}
            testing_criteria.append(tc)

        eval_obj = client.evals.create(
            name=f"Continuous Evaluation - {req.agent_name}",
            data_source_config=data_source_config,
            testing_criteria=testing_criteria,
        )
        logger.info("Created continuous eval definition: %s", eval_obj.id)

        # 2. Create the evaluation rule
        from azure.ai.projects.models import (
            EvaluationRule,
            ContinuousEvaluationRuleAction,
            EvaluationRuleFilter,
            EvaluationRuleEventType,
        )

        rule = project_client.evaluation_rules.create_or_update(
            id=req.rule_id,
            evaluation_rule=EvaluationRule(
                display_name=req.display_name,
                description=f"Continuous evaluation for agent {req.agent_name}",
                action=ContinuousEvaluationRuleAction(
                    eval_id=eval_obj.id,
                    max_hourly_runs=req.max_hourly_runs,
                ),
                event_type=EvaluationRuleEventType.RESPONSE_COMPLETED,
                filter=EvaluationRuleFilter(agent_name=req.agent_name),
                enabled=req.enabled,
            ),
        )
        logger.info("Created/updated continuous eval rule: %s", rule.id)

        return ContinuousEvalResponse(
            rule_id=rule.id,
            status="created",
            agent_name=req.agent_name,
            evaluators=req.evaluators,
            max_hourly_runs=req.max_hourly_runs,
        )

    except Exception as e:
        logger.exception("Failed to configure continuous evaluation")
        raise HTTPException(500, str(e))


@router.get("/rules")
async def list_continuous_rules():
    """List all continuous evaluation rules."""
    try:
        project_client = get_project_client()
        rules = list(project_client.evaluation_rules.list())
        return {
            "rules": [
                {
                    "id": r.id,
                    "display_name": getattr(r, "display_name", ""),
                    "enabled": getattr(r, "enabled", False),
                    "event_type": str(getattr(r, "event_type", "")),
                }
                for r in rules
            ]
        }
    except Exception as e:
        logger.exception("Failed to list rules")
        raise HTTPException(500, str(e))
