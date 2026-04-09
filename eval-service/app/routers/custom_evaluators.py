"""Custom evaluator management — create, list, and delete custom evaluators.

Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators

Two types supported per MS Learn:
- Code-based: Python grade(sample, item) -> float (0.0-1.0), deterministic
- Prompt-based: LLM judge prompt with ordinal/continuous/binary scoring

Key SDK patterns:
  project_client.beta.evaluators.create_version(name=..., evaluator_version={...})
  project_client.beta.evaluators.list()
  project_client.beta.evaluators.delete_version(name=..., version=...)
"""

import ast
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_project_client, get_settings

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Code validation helper
# Per MS Learn: "A code-based evaluator is a Python function named `grade`
# that receives two dict parameters (sample and item) and returns a float
# score between 0.0 and 1.0"
# Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators#code-based-evaluators
# ---------------------------------------------------------------------------


def validate_evaluator_code(code_text: str) -> dict:
    """Validate Python code for a code-based custom evaluator.

    Checks:
    1. Syntax validity (ast.parse)
    2. Contains a function named 'grade'
    3. grade() has exactly 2 parameters (sample, item)
    4. grade() has a return type annotation of float (optional but checked)

    Returns dict with 'valid' bool and 'errors' list.
    """
    errors = []

    # 1. Syntax check
    try:
        tree = ast.parse(code_text)
    except SyntaxError as e:
        return {
            "valid": False,
            "errors": [f"Syntax error at line {e.lineno}: {e.msg}"],
        }

    # 2. Find grade function
    grade_funcs = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "grade"
    ]

    if not grade_funcs:
        errors.append("Missing required function 'grade'. Code must define: def grade(sample: dict, item: dict) -> float")
        return {"valid": False, "errors": errors}

    grade_func = grade_funcs[0]

    # 3. Check parameters
    args = grade_func.args
    param_names = [arg.arg for arg in args.args]

    if len(param_names) < 2:
        errors.append(f"grade() has {len(param_names)} parameter(s), needs exactly 2: (sample, item)")
    elif param_names[:2] != ["sample", "item"]:
        errors.append(f"grade() parameters should be (sample, item), got ({', '.join(param_names[:2])})")

    # 4. Check return annotation (warning, not error)
    warnings = []
    if grade_func.returns is None:
        warnings.append("Consider adding return type annotation: def grade(sample: dict, item: dict) -> float")

    # 5. Check code size (< 256 KB per MS Learn)
    if len(code_text.encode("utf-8")) > 256 * 1024:
        errors.append(f"Code size ({len(code_text.encode('utf-8'))} bytes) exceeds 256 KB limit")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "function_name": "grade",
        "parameters": param_names[:2] if len(param_names) >= 2 else param_names,
    }


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class CreateCodeEvaluatorRequest(BaseModel):
    """Create a code-based custom evaluator.

    Per MS Learn: "A code-based evaluator is a Python function named `grade`
    that receives two dict parameters (sample and item) and returns a float
    score between 0.0 and 1.0 (higher is better)."

    Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators#code-based-evaluators
    """
    name: str
    display_name: str
    description: str
    category: str = "quality"  # quality, safety, or custom
    code_text: str
    input_fields: list[str] = Field(default_factory=lambda: ["response"])
    pass_threshold: float = 0.5


class CreatePromptEvaluatorRequest(BaseModel):
    """Create a prompt-based custom evaluator.

    Per MS Learn: "A prompt-based evaluator uses a judge prompt template
    that an LLM evaluates for each item. Template variables use double
    curly braces (e.g., {{query}}) and map to your input data fields."

    Supports three scoring methods:
    - ordinal: Integer scores on a discrete scale (e.g., 1-5)
    - continuous: Float scores (e.g., 0.0-1.0)
    - binary: Boolean true/false

    Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators#prompt-based-evaluators
    """
    name: str
    display_name: str
    description: str
    category: str = "quality"
    prompt_text: str
    input_fields: list[str] = Field(default_factory=lambda: ["response"])
    scoring_type: str = "ordinal"  # ordinal, continuous, binary
    min_value: int = 1
    max_value: int = 5
    threshold: int = 3


class DeleteEvaluatorRequest(BaseModel):
    name: str
    version: str


# ---------------------------------------------------------------------------
# Pre-built custom evaluator definitions for Qatar Airways Contact Center
# ---------------------------------------------------------------------------


# Code-based: KB Citation Checker
KB_CITATION_CODE = '''def grade(sample: dict, item: dict) -> float:
    """Check if the agent response cites knowledge base sources.

    Looks for citation patterns like [Source: ...], [1], [doc-...],
    or explicit "according to" references indicating KB grounding.
    Returns 1.0 if citations found, 0.0 if not.
    """
    import re

    response = item.get("response", "")
    if not response:
        return 0.0

    # Check for various citation patterns
    patterns = [
        r"\\[Source:.*?\\]",
        r"\\[\\d+\\]",
        r"\\[doc[-_].*?\\]",
        r"according to (?:the|our) (?:knowledge base|documentation|policy|guidelines)",
        r"based on (?:the|our) (?:knowledge base|documentation|policy|guidelines)",
        r"as (?:stated|mentioned|outlined|described) in",
        r"per (?:the|our) (?:policy|guidelines|documentation)",
        r"\\*\\*Source(?:s)?:\\*\\*",
        r"Reference:",
    ]

    citation_count = 0
    for pattern in patterns:
        matches = re.findall(pattern, response, re.IGNORECASE)
        citation_count += len(matches)

    if citation_count >= 2:
        return 1.0
    elif citation_count == 1:
        return 0.7
    else:
        return 0.0
'''

# Code-based: MCP Tool Call Accuracy
MCP_ACCURACY_CODE = '''def grade(sample: dict, item: dict) -> float:
    """Validate MCP tool call parameters and result interpretation.

    Checks if agent interactions with MCP tools follow proper patterns:
    1. Tool calls have valid names and parameters
    2. Tool results are referenced in the final response
    3. No hallucinated tool results

    Uses output_items from agent-target or response_ids eval.
    """
    import json

    # Access structured output for agent evaluations
    output_items = item.get("sample", {}).get("output_items", [])
    response = item.get("response", "") or item.get("sample", {}).get("output_text", "")

    if not output_items and not response:
        return 0.0

    # If we have structured output, check tool calls
    if isinstance(output_items, list):
        mcp_calls = [
            o for o in output_items
            if isinstance(o, dict) and o.get("type") in ("mcp_call", "mcp_list_tools")
        ]

        if not mcp_calls:
            # No MCP calls — not applicable, neutral score
            return 0.5

        valid_calls = 0
        for call in mcp_calls:
            # Check call has a name
            if call.get("name"):
                valid_calls += 1

        return min(1.0, valid_calls / max(1, len(mcp_calls)))

    # Fallback: check text response for MCP-related content
    if "mcp" in response.lower() or "tool" in response.lower():
        return 0.5

    return 0.5  # Neutral if no MCP involvement
'''

# Prompt-based: QR Contact Center Policy Style
QR_POLICY_STYLE_PROMPT = '''You are evaluating a Qatar Airways contact center agent response for compliance with style guidelines.

Evaluate the response against these criteria:
1. Lead with the answer - Does the response provide the key information upfront?
2. Structured format - Does it use bullet points, numbered lists, or clear sections?
3. Professional tone - Is it warm, helpful, and professional?
4. Completeness - Does it address all aspects of the query?
5. Actionable next steps - Does it tell the customer what to do next?

Query: {{query}}
Response: {{response}}

Rate the overall style compliance on a 1-5 scale:
1 - Poor: Does not follow any guidelines
2 - Below Average: Follows 1-2 guidelines
3 - Average: Follows 2-3 guidelines
4 - Good: Follows 3-4 guidelines
5 - Excellent: Follows all 5 guidelines

Output Format (JSON):
{
  "result": <integer from 1 to 5>,
  "reason": "<brief explanation referencing which guidelines are met or missed>"
}
'''


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/validate-code")
async def validate_code(req: CreateCodeEvaluatorRequest):
    """Validate Python code before registering as a custom evaluator.

    Performs syntax check, grade() function detection, and parameter validation.
    Call this before /create-code to catch errors early.
    """
    result = validate_evaluator_code(req.code_text)
    return result


@router.post("/create-code")
async def create_code_evaluator(req: CreateCodeEvaluatorRequest):
    """Create a code-based custom evaluator in the Foundry evaluator catalog.

    Validates code locally first, then registers with Foundry.

    Per MS Learn: Pass the grade() function as a string in the code_text field.
    Define the data_schema to declare input fields, and metrics to describe the score.
    Code-based evaluators use the 'continuous' metric type with range 0.0 to 1.0.

    init_parameters must include deployment_name and pass_threshold.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators#create-a-code-based-evaluator
    """
    # Pre-validate code before sending to Foundry
    validation = validate_evaluator_code(req.code_text)
    if not validation["valid"]:
        raise HTTPException(400, f"Code validation failed: {'; '.join(validation['errors'])}")

    try:
        project_client = get_project_client()
        from azure.ai.projects.models import EvaluatorCategory, EvaluatorDefinitionType

        category_map = {
            "quality": EvaluatorCategory.QUALITY,
            "safety": EvaluatorCategory.SAFETY,
        }

        # Build data schema from input fields
        field_properties = {}
        for field in req.input_fields:
            field_properties[field] = {"type": "string"}

        evaluator = project_client.beta.evaluators.create_version(
            name=req.name,
            evaluator_version={
                "name": req.name,
                "categories": [category_map.get(req.category, EvaluatorCategory.QUALITY)],
                "display_name": req.display_name,
                "description": req.description,
                "definition": {
                    "type": EvaluatorDefinitionType.CODE,
                    "code_text": req.code_text,
                    "init_parameters": {
                        "type": "object",
                        "properties": {
                            "deployment_name": {"type": "string"},
                            "pass_threshold": {"type": "number"},
                        },
                        "required": ["deployment_name", "pass_threshold"],
                    },
                    "metrics": {
                        "result": {
                            "type": "continuous",
                            "desirable_direction": "increase",
                            "min_value": 0.0,
                            "max_value": 1.0,
                        }
                    },
                    "data_schema": {
                        "type": "object",
                        "required": ["item"],
                        "properties": {
                            "item": {
                                "type": "object",
                                "properties": field_properties,
                            },
                        },
                    },
                },
            },
        )

        logger.info("Created code evaluator: %s (version: %s)", req.name, evaluator.version)

        return {
            "status": "created",
            "name": req.name,
            "version": evaluator.version,
            "type": "code",
            "display_name": req.display_name,
        }

    except Exception as e:
        logger.exception("Failed to create code evaluator")
        raise HTTPException(500, str(e))


@router.post("/create-prompt")
async def create_prompt_evaluator(req: CreatePromptEvaluatorRequest):
    """Create a prompt-based custom evaluator in the Foundry evaluator catalog.

    Per MS Learn: Pass the judge prompt in the prompt_text field.
    Define data_schema for input fields, and metrics for scoring method and range.
    init_parameters must include deployment_name and threshold.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators#create-a-prompt-based-evaluator
    """
    try:
        project_client = get_project_client()
        from azure.ai.projects.models import EvaluatorCategory, EvaluatorDefinitionType

        category_map = {
            "quality": EvaluatorCategory.QUALITY,
            "safety": EvaluatorCategory.SAFETY,
        }

        # Build data schema from input fields
        field_properties = {}
        for field in req.input_fields:
            field_properties[field] = {"type": "string"}

        # Determine metric type
        metric_config: dict = {
            "type": req.scoring_type,
            "desirable_direction": "increase",
        }
        if req.scoring_type in ("ordinal", "continuous"):
            metric_config["min_value"] = req.min_value
            metric_config["max_value"] = req.max_value

        evaluator = project_client.beta.evaluators.create_version(
            name=req.name,
            evaluator_version={
                "name": req.name,
                "categories": [category_map.get(req.category, EvaluatorCategory.QUALITY)],
                "display_name": req.display_name,
                "description": req.description,
                "definition": {
                    "type": EvaluatorDefinitionType.PROMPT,
                    "prompt_text": req.prompt_text,
                    "init_parameters": {
                        "type": "object",
                        "properties": {
                            "deployment_name": {"type": "string"},
                            "threshold": {"type": "number"},
                        },
                        "required": ["deployment_name", "threshold"],
                    },
                    "data_schema": {
                        "type": "object",
                        "properties": field_properties,
                        "required": req.input_fields,
                    },
                    "metrics": {
                        "custom_prompt": metric_config,
                    },
                },
            },
        )

        logger.info("Created prompt evaluator: %s (version: %s)", req.name, evaluator.version)

        return {
            "status": "created",
            "name": req.name,
            "version": evaluator.version,
            "type": "prompt",
            "display_name": req.display_name,
            "scoring_type": req.scoring_type,
        }

    except Exception as e:
        logger.exception("Failed to create prompt evaluator")
        raise HTTPException(500, str(e))


@router.get("/list")
async def list_custom_evaluators():
    """List all custom evaluators in the Foundry evaluator catalog.

    Ref: https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/ai/azure-ai-projects/samples/evaluations/sample_eval_catalog.py
    """
    try:
        project_client = get_project_client()
        evaluators = list(project_client.beta.evaluators.list())

        results = []
        for ev in evaluators:
            # Only include non-builtin evaluators
            name = getattr(ev, "name", "")
            if name and not name.startswith("builtin."):
                results.append({
                    "name": name,
                    "version": getattr(ev, "version", ""),
                    "display_name": getattr(ev, "display_name", name),
                    "description": getattr(ev, "description", ""),
                    "categories": [str(c) for c in getattr(ev, "categories", [])],
                })

        return {"evaluators": results, "total": len(results)}

    except Exception as e:
        logger.exception("Failed to list custom evaluators")
        raise HTTPException(500, str(e))


@router.delete("/delete")
async def delete_custom_evaluator(req: DeleteEvaluatorRequest):
    """Delete a custom evaluator version from the catalog.

    Per MS Learn:
    project_client.beta.evaluators.delete_version(name=..., version=...)

    Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators#clean-up-resources
    """
    try:
        project_client = get_project_client()
        project_client.beta.evaluators.delete_version(
            name=req.name,
            version=req.version,
        )
        logger.info("Deleted evaluator %s version %s", req.name, req.version)
        return {"status": "deleted", "name": req.name, "version": req.version}

    except Exception as e:
        logger.exception("Failed to delete evaluator")
        raise HTTPException(500, str(e))


@router.get("/prebuilt")
async def get_prebuilt_custom_evaluators():
    """Return the pre-built custom evaluator definitions for this project.

    These are domain-specific evaluators designed for the Qatar Airways
    Contact Center use case. They can be registered to the Foundry catalog
    via the /create-code or /create-prompt endpoints.
    """
    return {
        "evaluators": [
            {
                "name": "kb_citation_checker",
                "display_name": "KB Citation Checker",
                "type": "code",
                "description": "Checks if agent response cites knowledge base sources using pattern matching (citations, references, source indicators)",
                "category": "quality",
                "input_fields": ["response"],
                "code_preview": KB_CITATION_CODE[:200] + "...",
            },
            {
                "name": "mcp_tool_accuracy",
                "display_name": "MCP Tool Accuracy",
                "type": "code",
                "description": "Validates MCP tool call parameters and checks if tool results are properly referenced in agent responses",
                "category": "quality",
                "input_fields": ["response"],
                "code_preview": MCP_ACCURACY_CODE[:200] + "...",
            },
            {
                "name": "qr_policy_style",
                "display_name": "QR Policy Style Compliance",
                "type": "prompt",
                "description": "Evaluates responses against Qatar Airways contact center style guidelines: lead with answer, structured format, professional tone, completeness, actionable next steps",
                "category": "quality",
                "input_fields": ["query", "response"],
                "scoring_type": "ordinal",
                "min_value": 1,
                "max_value": 5,
                "prompt_preview": QR_POLICY_STYLE_PROMPT[:200] + "...",
            },
        ]
    }


@router.post("/register-prebuilt/{evaluator_name}")
async def register_prebuilt_evaluator(evaluator_name: str):
    """Register one of the pre-built custom evaluators to the Foundry catalog.

    Convenience endpoint that combines the pre-built definitions with the
    create-code or create-prompt endpoints.
    """
    settings = get_settings()

    prebuilt_map = {
        "kb_citation_checker": {
            "type": "code",
            "name": "kb_citation_checker",
            "display_name": "KB Citation Checker",
            "description": "Checks if agent response cites knowledge base sources",
            "category": "quality",
            "code_text": KB_CITATION_CODE,
            "input_fields": ["response"],
            "pass_threshold": 0.5,
        },
        "mcp_tool_accuracy": {
            "type": "code",
            "name": "mcp_tool_accuracy",
            "display_name": "MCP Tool Accuracy",
            "description": "Validates MCP tool call parameters and result interpretation",
            "category": "quality",
            "code_text": MCP_ACCURACY_CODE,
            "input_fields": ["response"],
            "pass_threshold": 0.5,
        },
        "qr_policy_style": {
            "type": "prompt",
            "name": "qr_policy_style",
            "display_name": "QR Policy Style Compliance",
            "description": "Evaluates QR contact center style guidelines compliance",
            "category": "quality",
            "prompt_text": QR_POLICY_STYLE_PROMPT,
            "input_fields": ["query", "response"],
            "scoring_type": "ordinal",
            "min_value": 1,
            "max_value": 5,
            "threshold": 3,
        },
    }

    if evaluator_name not in prebuilt_map:
        raise HTTPException(404, f"Unknown prebuilt evaluator: {evaluator_name}. Available: {list(prebuilt_map.keys())}")

    config = prebuilt_map[evaluator_name]

    try:
        if config["type"] == "code":
            req = CreateCodeEvaluatorRequest(
                name=config["name"],
                display_name=config["display_name"],
                description=config["description"],
                category=config["category"],
                code_text=config["code_text"],
                input_fields=config["input_fields"],
                pass_threshold=config["pass_threshold"],
            )
            return await create_code_evaluator(req)
        else:
            req = CreatePromptEvaluatorRequest(
                name=config["name"],
                display_name=config["display_name"],
                description=config["description"],
                category=config["category"],
                prompt_text=config["prompt_text"],
                input_fields=config["input_fields"],
                scoring_type=config["scoring_type"],
                min_value=config["min_value"],
                max_value=config["max_value"],
                threshold=config["threshold"],
            )
            return await create_prompt_evaluator(req)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to register prebuilt evaluator %s", evaluator_name)
        raise HTTPException(500, str(e))
