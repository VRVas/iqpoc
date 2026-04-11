"""Evaluation endpoints — batch, single, by-response-ids, agent-target, synthetic, model-target."""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings, get_openai_client
from app.services.eval_service import (
    create_eval_and_run_dataset,
    create_eval_and_run_agent_target,
    create_eval_and_run_response_ids,
    create_eval_and_run_synthetic,
    poll_eval_run,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class DataSourceConfig(BaseModel):
    type: str = "response_ids"  # response_ids | inline | dataset_file
    response_ids: Optional[list[str]] = None
    items: Optional[list[dict]] = None  # For inline data


class BatchEvalRequest(BaseModel):
    name: str = "Batch Evaluation"
    agent_name: Optional[str] = None
    evaluators: list[str] = Field(default_factory=lambda: ["coherence", "violence"])
    model_deployment: Optional[str] = None
    data_source: DataSourceConfig


class SingleEvalRequest(BaseModel):
    query: str
    response: str
    context: Optional[str] = None
    ground_truth: Optional[str] = None
    evaluators: list[str] = Field(default_factory=lambda: ["coherence"])
    model_deployment: Optional[str] = None


class AgentTargetRequest(BaseModel):
    name: str = "Agent Target Evaluation"
    agent_name: str
    agent_version: Optional[str] = None
    queries: list[dict]  # [{"query": "..."}, ...]
    evaluators: list[str] = Field(default_factory=lambda: ["coherence", "violence", "task_adherence"])
    model_deployment: Optional[str] = None
    tool_definitions: Optional[list[dict]] = None  # OpenAI function-calling schema


class ResponseIdsRequest(BaseModel):
    name: str = "Response ID Evaluation"
    response_ids: list[str]
    evaluators: list[str] = Field(default_factory=lambda: ["coherence", "violence"])
    model_deployment: Optional[str] = None


class SyntheticEvalRequest(BaseModel):
    name: str = "Synthetic Evaluation"
    agent_name: str
    agent_version: Optional[str] = None
    prompt: str = "Generate diverse customer service questions"
    samples_count: int = 10
    evaluators: list[str] = Field(default_factory=lambda: ["coherence", "violence"])
    model_deployment: Optional[str] = None
    tool_definitions: Optional[list[dict]] = None  # OpenAI function-calling schema


class ModelTargetRequest(BaseModel):
    """Model target evaluation — send queries to a raw model deployment.

    Per MS Learn: "Send queries to a deployed model at runtime and evaluate the
    responses using the azure_ai_target_completions data source type with an
    azure_ai_model target."

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#model-target-evaluation
    """
    name: str = "Model Target Evaluation"
    target_model: str  # Model deployment name to evaluate (e.g., "gpt-4.1-mini")
    queries: list[dict]  # [{"query": "..."}, ...]
    evaluators: list[str] = Field(default_factory=lambda: ["coherence", "violence"])
    model_deployment: Optional[str] = None  # Judge model for AI-assisted evaluators
    system_prompt: Optional[str] = None  # Optional system message for the target model
    max_completion_tokens: int = 2048
    top_p: float = 1.0


class EvalRunResponse(BaseModel):
    eval_id: str
    run_id: str
    status: str
    poll_url: str
    estimated_duration_seconds: Optional[int] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/batch", response_model=EvalRunResponse)
async def evaluate_batch(req: BatchEvalRequest):
    """Trigger a batch evaluation on inline data or response IDs."""
    settings = get_settings()
    model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        if req.data_source.type == "response_ids" and req.data_source.response_ids:
            result = create_eval_and_run_response_ids(
                name=req.name,
                response_ids=req.data_source.response_ids,
                evaluator_names=req.evaluators,
                model_deployment=model,
            )
        elif req.data_source.type == "inline" and req.data_source.items:
            result = create_eval_and_run_dataset(
                name=req.name,
                items=req.data_source.items,
                evaluator_names=req.evaluators,
                model_deployment=model,
            )
        else:
            raise HTTPException(400, "Invalid data_source: provide response_ids or inline items")

        return EvalRunResponse(
            eval_id=result["eval_id"],
            run_id=result["run_id"],
            status=result["status"],
            poll_url=f"/evaluate/status/{result['run_id']}?eval_id={result['eval_id']}",
            estimated_duration_seconds=len(req.data_source.response_ids or req.data_source.items or []) * 15,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Batch eval failed")
        raise HTTPException(500, str(e))


@router.post("/agent-target", response_model=EvalRunResponse)
async def evaluate_agent_target(req: AgentTargetRequest):
    """Send test queries to an agent and evaluate responses."""
    settings = get_settings()
    model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        result = create_eval_and_run_agent_target(
            name=req.name,
            agent_name=req.agent_name,
            agent_version=req.agent_version,
            queries=req.queries,
            evaluator_names=req.evaluators,
            model_deployment=model,
            tool_definitions=req.tool_definitions,
        )
        return EvalRunResponse(
            eval_id=result["eval_id"],
            run_id=result["run_id"],
            status=result["status"],
            poll_url=f"/evaluate/status/{result['run_id']}?eval_id={result['eval_id']}",
            estimated_duration_seconds=len(req.queries) * 20,
        )
    except Exception as e:
        logger.exception("Agent target eval failed")
        raise HTTPException(500, str(e))


@router.post("/by-response-ids", response_model=EvalRunResponse)
async def evaluate_by_response_ids(req: ResponseIdsRequest):
    """Evaluate specific Foundry response IDs."""
    settings = get_settings()
    model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        result = create_eval_and_run_response_ids(
            name=req.name,
            response_ids=req.response_ids,
            evaluator_names=req.evaluators,
            model_deployment=model,
        )
        return EvalRunResponse(
            eval_id=result["eval_id"],
            run_id=result["run_id"],
            status=result["status"],
            poll_url=f"/evaluate/status/{result['run_id']}?eval_id={result['eval_id']}",
        )
    except Exception as e:
        logger.exception("Response ID eval failed")
        raise HTTPException(500, str(e))


@router.post("/synthetic", response_model=EvalRunResponse)
async def evaluate_synthetic(req: SyntheticEvalRequest):
    """Generate synthetic queries and evaluate agent responses."""
    settings = get_settings()
    model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        result = create_eval_and_run_synthetic(
            name=req.name,
            agent_name=req.agent_name,
            agent_version=req.agent_version,
            prompt=req.prompt,
            samples_count=req.samples_count,
            evaluator_names=req.evaluators,
            model_deployment=model,
            tool_definitions=req.tool_definitions,
        )
        return EvalRunResponse(
            eval_id=result["eval_id"],
            run_id=result["run_id"],
            status=result["status"],
            poll_url=f"/evaluate/status/{result['run_id']}?eval_id={result['eval_id']}",
            estimated_duration_seconds=req.samples_count * 20,
        )
    except Exception as e:
        logger.exception("Synthetic eval failed")
        raise HTTPException(500, str(e))


@router.post("/model-target", response_model=EvalRunResponse)
async def evaluate_model_target(req: ModelTargetRequest):
    """Send queries to a model deployment and evaluate responses.

    Per MS Learn: "Send queries to a deployed model at runtime and evaluate
    the responses using the azure_ai_target_completions data source type
    with an azure_ai_model target."

    Uses {{sample.output_text}} in data_mapping to reference model's output.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#model-target-evaluation
    """
    settings = get_settings()
    judge_model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        from openai.types.eval_create_params import DataSourceConfigCustom
        from app.services.eval_service import build_testing_criteria

        client = get_openai_client()

        # Schema — only query in input, response generated at runtime
        data_source_config = DataSourceConfigCustom(
            type="custom",
            item_schema={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            include_sample_schema=True,
        )

        # Build testing criteria with sample.output_text substitution
        testing_criteria = build_testing_criteria(
            req.evaluators, judge_model,
            use_sample_output=True,
            eval_mode="agent_target",  # same mode — model generates responses
        )

        eval_obj = client.evals.create(
            name=req.name,
            data_source_config=data_source_config,
            testing_criteria=testing_criteria,
        )

        # Build input_messages template
        # Per MS Learn: "The input_messages template controls how queries are sent to the model"
        templates = []
        if req.system_prompt:
            templates.append({
                "type": "message",
                "role": "system",
                "content": {"type": "input_text", "text": req.system_prompt},
            })
        templates.append({
            "type": "message",
            "role": "user",
            "content": {"type": "input_text", "text": "{{item.query}}"},
        })

        input_messages = {"type": "template", "template": templates}

        # Per MS Learn: target type is azure_ai_model
        target = {
            "type": "azure_ai_model",
            "model": req.target_model,
            "sampling_params": {
                "top_p": req.top_p,
                "max_completion_tokens": req.max_completion_tokens,
            },
        }

        data_source = {
            "type": "azure_ai_target_completions",
            "source": {"type": "file_content", "content": [{"item": q} for q in req.queries]},
            "input_messages": input_messages,
            "target": target,
        }

        eval_run = client.evals.runs.create(
            eval_id=eval_obj.id,
            name=f"{req.name} run",
            data_source=data_source,
        )

        return EvalRunResponse(
            eval_id=eval_obj.id,
            run_id=eval_run.id,
            status=eval_run.status,
            poll_url=f"/evaluate/status/{eval_run.id}?eval_id={eval_obj.id}",
            estimated_duration_seconds=len(req.queries) * 15,
        )

    except Exception as e:
        logger.exception("Model target eval failed")
        raise HTTPException(500, str(e))


@router.post("/single")
async def evaluate_single(req: SingleEvalRequest):
    """Evaluate a single query-response pair synchronously."""
    settings = get_settings()
    model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

    try:
        # Build inline data with single item
        items = [{"query": req.query, "response": req.response}]
        if req.context:
            items[0]["context"] = req.context
        if req.ground_truth:
            items[0]["ground_truth"] = req.ground_truth

        result = create_eval_and_run_dataset(
            name="Single evaluation",
            items=items,
            evaluator_names=req.evaluators,
            model_deployment=model,
        )

        # Poll for completion (synchronous — wait up to 60s)
        final = poll_eval_run(result["eval_id"], result["run_id"], timeout_seconds=60)
        return final

    except Exception as e:
        logger.exception("Single eval failed")
        raise HTTPException(500, str(e))


@router.get("/status/{run_id}")
async def get_eval_status(run_id: str, eval_id: str):
    """Poll evaluation run status and get results."""
    try:
        result = poll_eval_run(eval_id, run_id, timeout_seconds=5)
        return result
    except Exception as e:
        logger.exception("Status check failed")
        raise HTTPException(500, str(e))
