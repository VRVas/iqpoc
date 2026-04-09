"""Scheduled evaluation management — create, list, delete recurring evaluation schedules.

Per the Foundry v2 SDK sample (sample_scheduled_evaluations.py):
- Schedule uses RecurrenceTrigger with DailyRecurrenceSchedule
- EvaluationScheduleTask binds an eval_id to a run configuration
- project_client.beta.schedules.create_or_update() creates/updates schedules
- project_client.beta.schedules.list_runs() lists schedule runs
- project_client.beta.schedules.delete() removes a schedule

Ref: https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/ai/azure-ai-projects/samples/evaluations/sample_scheduled_evaluations.py
Ref: https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard?tabs=python#configure-settings
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_openai_client, get_project_client, get_settings
from app.services.eval_service import EVALUATOR_REGISTRY

router = APIRouter()
logger = logging.getLogger("app")


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class CreateScheduleRequest(BaseModel):
    """Create a scheduled evaluation that runs on a recurring basis.

    Per MS Learn, scheduled evaluations validate performance against benchmarks
    on a set schedule (e.g., daily at 9 AM).
    """
    schedule_id: str
    display_name: str = "Scheduled Evaluation"
    agent_name: str
    dataset_id: Optional[str] = None  # file_id from uploaded dataset (optional)
    evaluators: list[str] = Field(default_factory=lambda: ["violence", "coherence"])
    model_deployment: Optional[str] = None
    # Schedule config
    interval_days: int = 1  # Run every N days
    hours: list[int] = Field(default_factory=lambda: [9])  # Hours of day (UTC) to run
    enabled: bool = True
    # Optional: inline test data if no dataset_id
    test_queries: Optional[list[dict]] = None  # [{"query": "...", "response": "..."}]


class ScheduleResponse(BaseModel):
    schedule_id: str
    eval_id: str
    status: str
    display_name: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/create", response_model=ScheduleResponse)
async def create_schedule(req: CreateScheduleRequest):
    """Create a scheduled evaluation rule.

    Per Foundry v2 SDK (sample_scheduled_evaluations.py):
    1. Create an eval definition with testing_criteria
    2. Build an eval_run_object with data source (dataset file_id or inline)
    3. Create a Schedule with RecurrenceTrigger + EvaluationScheduleTask
    4. Register via project_client.beta.schedules.create_or_update()
    """
    settings = get_settings()
    model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        client = get_openai_client()
        project_client = get_project_client()

        from azure.ai.projects.models import (
            Schedule,
            RecurrenceTrigger,
            DailyRecurrenceSchedule,
            EvaluationScheduleTask,
        )
        from openai.types.eval_create_params import DataSourceConfigCustom
        from openai.types.evals.create_eval_jsonl_run_data_source_param import (
            CreateEvalJSONLRunDataSourceParam,
            SourceFileContent,
            SourceFileContentContent,
            SourceFileID,
        )

        # 1. Build testing criteria from evaluators
        testing_criteria = []
        for name in req.evaluators:
            reg = EVALUATOR_REGISTRY.get(name)
            tc = {
                "type": "azure_ai_evaluator",
                "name": name,
                "evaluator_name": reg["evaluator_name"] if reg else f"builtin.{name}",
            }
            if reg and reg.get("requires_model"):
                tc["initialization_parameters"] = {"deployment_name": model}
            # For dataset evals, use item.response mapping
            if reg and not reg.get("uses_output_items"):
                tc["data_mapping"] = dict(reg.get("data_mapping", {}))
            testing_criteria.append(tc)

        # 2. Create eval definition
        data_source_config = DataSourceConfigCustom(
            type="custom",
            item_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "response": {"type": "string"},
                    "context": {"type": "string"},
                    "ground_truth": {"type": "string"},
                },
                "required": [],
            },
            include_sample_schema=True,
        )

        eval_obj = client.evals.create(
            name=f"Scheduled: {req.display_name}",
            data_source_config=data_source_config,
            testing_criteria=testing_criteria,
        )
        logger.info("Created scheduled eval definition: %s", eval_obj.id)

        # 3. Build eval run object
        if req.dataset_id:
            # Use uploaded dataset file_id
            eval_run_object = {
                "eval_id": eval_obj.id,
                "name": f"{req.display_name} scheduled run",
                "data_source": CreateEvalJSONLRunDataSourceParam(
                    type="jsonl",
                    source=SourceFileID(type="file_id", id=req.dataset_id),
                ),
            }
        elif req.test_queries:
            # Use inline test data
            eval_run_object = {
                "eval_id": eval_obj.id,
                "name": f"{req.display_name} scheduled run",
                "data_source": CreateEvalJSONLRunDataSourceParam(
                    type="jsonl",
                    source=SourceFileContent(
                        type="file_content",
                        content=[SourceFileContentContent(item=q) for q in req.test_queries],
                    ),
                ),
            }
        else:
            raise HTTPException(400, "Either dataset_id or test_queries must be provided for scheduled evaluations")

        # 4. Create schedule
        # Per SDK sample: RecurrenceTrigger(interval=1, schedule=DailyRecurrenceSchedule(hours=[9]))
        schedule = Schedule(
            display_name=req.display_name,
            enabled=req.enabled,
            trigger=RecurrenceTrigger(
                interval=req.interval_days,
                schedule=DailyRecurrenceSchedule(hours=req.hours),
            ),
            task=EvaluationScheduleTask(
                eval_id=eval_obj.id,
                eval_run=eval_run_object,
            ),
        )

        schedule_response = project_client.beta.schedules.create_or_update(
            schedule_id=req.schedule_id,
            schedule=schedule,
        )
        logger.info("Created schedule: %s", schedule_response.schedule_id)

        return ScheduleResponse(
            schedule_id=schedule_response.schedule_id,
            eval_id=eval_obj.id,
            status="created",
            display_name=req.display_name,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create schedule")
        raise HTTPException(500, str(e))


@router.get("/list")
async def list_schedules():
    """List all evaluation schedules.

    Note: The beta.schedules API may not have a direct list() method.
    We track schedule IDs through the eval history.
    """
    try:
        project_client = get_project_client()
        # Try listing schedules if the API supports it
        try:
            schedules = list(project_client.beta.schedules.list())
            return {
                "schedules": [
                    {
                        "schedule_id": getattr(s, "schedule_id", ""),
                        "display_name": getattr(s, "display_name", ""),
                        "enabled": getattr(s, "enabled", False),
                    }
                    for s in schedules
                ],
            }
        except AttributeError:
            # list() may not exist — return empty
            return {"schedules": [], "note": "Schedule listing not yet supported by SDK"}

    except Exception as e:
        logger.exception("Failed to list schedules")
        raise HTTPException(500, str(e))


@router.get("/runs/{schedule_id}")
async def list_schedule_runs(schedule_id: str):
    """List runs for a specific schedule.

    Per SDK sample: project_client.beta.schedules.list_runs(schedule_id)
    """
    try:
        project_client = get_project_client()
        runs = list(project_client.beta.schedules.list_runs(schedule_id))

        return {
            "schedule_id": schedule_id,
            "runs": [
                {
                    "id": getattr(r, "id", ""),
                    "status": getattr(r, "status", "unknown"),
                    "created_at": getattr(r, "created_at", None),
                }
                for r in runs
            ],
        }

    except Exception as e:
        logger.exception("Failed to list schedule runs")
        raise HTTPException(500, str(e))


@router.delete("/delete/{schedule_id}")
async def delete_schedule(schedule_id: str):
    """Delete a scheduled evaluation.

    Per SDK sample: project_client.beta.schedules.delete(schedule_id)
    """
    try:
        project_client = get_project_client()
        project_client.beta.schedules.delete(schedule_id)
        logger.info("Deleted schedule: %s", schedule_id)
        return {"status": "deleted", "schedule_id": schedule_id}

    except Exception as e:
        logger.exception("Failed to delete schedule")
        raise HTTPException(500, str(e))
