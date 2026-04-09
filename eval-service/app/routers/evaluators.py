"""List available evaluators."""

import logging
from fastapi import APIRouter
from app.services.eval_service import EVALUATOR_REGISTRY

router = APIRouter()
logger = logging.getLogger(__name__)

# Descriptions and caveats for each evaluator, grounded in MS Learn docs
EVALUATOR_META = {
    "coherence": {"desc": "Measures logical consistency and flow of ideas in the response", "caveat": None},
    "fluency": {"desc": "Measures grammatical accuracy, vocabulary range, and readability", "caveat": None},
    "groundedness": {"desc": "Checks if the response is grounded in retrieved context without fabrication", "caveat": "Limited support with Code Interpreter tool calls in conversation"},
    "groundedness_pro": {"desc": "Strict groundedness check via Azure AI Content Safety (binary pass/fail)", "caveat": "Requires context field. Uses Azure AI Content Safety service model."},
    "relevance": {"desc": "Measures how accurately the response addresses the user's query", "caveat": None},
    "retrieval": {"desc": "Measures how relevant the retrieved context chunks are to the query", "caveat": None},
    "response_completeness": {"desc": "Checks if the response covers all critical information vs ground truth (recall)", "caveat": "Requires ground_truth field in test data"},
    "violence": {"desc": "Detects violent or threatening content (0-7 severity scale)", "caveat": None},
    "hate_unfairness": {"desc": "Detects biased, discriminatory, or hateful content (0-7 severity)", "caveat": None},
    "sexual": {"desc": "Detects inappropriate sexual content (0-7 severity)", "caveat": None},
    "self_harm": {"desc": "Detects content promoting or describing self-harm (0-7 severity)", "caveat": None},
    "protected_material": {"desc": "Detects copyrighted or protected content (song lyrics, recipes, articles)", "caveat": None},
    "indirect_attack": {"desc": "Detects indirect jailbreak attempts (XPIA) — manipulated content, intrusion, info gathering", "caveat": None},
    "code_vulnerability": {"desc": "Detects security vulnerabilities in generated code (SQL injection, XSS, etc.)", "caveat": None},
    "ungrounded_attributes": {"desc": "Detects fabricated personal inferences (demographics, emotional state) not in context", "caveat": "Requires context field"},
    "prohibited_actions": {"desc": "Detects agent behaviors violating explicitly disallowed actions or tool uses", "caveat": "Red teaming only. Not available in standard agent-target evaluations."},
    "sensitive_data_leakage": {"desc": "Detects exposure of sensitive information (financial, PII, health data)", "caveat": "Red teaming only. Not available in standard agent-target evaluations."},
    "task_adherence": {"desc": "Checks if the agent follows its system instructions, rules, and constraints", "caveat": None},
    "task_completion": {"desc": "Checks if the agent fully completed the requested task end-to-end", "caveat": "Preview feature"},
    "intent_resolution": {"desc": "Measures how accurately the agent identifies and addresses user intentions", "caveat": None},
    "tool_call_accuracy": {"desc": "Overall quality of tool calls — selection, parameter correctness, and efficiency", "caveat": "Requires tool_definitions. Limited support with Azure AI Search and Code Interpreter tools."},
    "tool_selection": {"desc": "Checks if the agent selected the correct and necessary tools without redundancy", "caveat": "Requires tool_definitions. Limited support with Azure AI Search and Code Interpreter tools."},
    "tool_input_accuracy": {"desc": "Validates all tool call parameters across 6 criteria: grounding, type, format, completeness", "caveat": "Requires tool_definitions. Limited support with Azure AI Search and Code Interpreter tools."},
    "tool_output_utilization": {"desc": "Checks if the agent correctly interpreted and used tool results in responses", "caveat": "Requires tool_definitions. Limited support with Azure AI Search and Code Interpreter tools."},
    "tool_call_success": {"desc": "Checks if all tool calls executed without technical failures", "caveat": "Limited support with Code Interpreter and Azure AI Search tools"},
    "f1_score": {"desc": "Harmonic mean of precision and recall in token overlap between response and ground truth", "caveat": "Requires ground_truth field in test data"},
}


@router.get("/list")
async def list_evaluators():
    """List all available built-in and custom evaluators with descriptions and caveats."""
    built_in = []
    for name, reg in EVALUATOR_REGISTRY.items():
        meta = EVALUATOR_META.get(name, {"desc": "", "caveat": None})
        built_in.append({
            "name": reg["evaluator_name"],
            "short_name": name,
            "category": reg["category"],
            "requires_model": reg["requires_model"],
            "input_fields": list(reg["data_mapping"].keys()),
            "description": meta["desc"],
            "caveat": meta["caveat"],
            "red_team_only": reg.get("red_team_only", False),
            "modes": reg.get("modes", []),
            "requires_tool_definitions": reg.get("requires_tool_definitions", False),
        })

    # Fetch custom evaluators dynamically from the Foundry catalog
    custom = []
    try:
        from app.config import get_project_client
        project_client = get_project_client()
        for ev in project_client.beta.evaluators.list():
            name = getattr(ev, "name", "")
            if name and not name.startswith("builtin."):
                custom.append({
                    "name": name,
                    "short_name": name,
                    "category": "domain",
                    "description": getattr(ev, "description", ""),
                    "caveat": None,
                })
    except Exception as e:
        logger.warning("Could not fetch custom evaluators from catalog: %s", e)
        # Fallback to static list
        custom = [
            {"name": "custom.kb_citation", "short_name": "kb_citation", "category": "domain", "description": "Checks if agent cites KB sources in responses", "caveat": None},
            {"name": "custom.mcp_accuracy", "short_name": "mcp_accuracy", "category": "domain", "description": "Validates MCP tool call parameters and result interpretation", "caveat": None},
            {"name": "custom.qr_policy_style", "short_name": "qr_policy_style", "category": "domain", "description": "Checks QR contact center style guidelines (lead with answer, cite sources, bullet points)", "caveat": None},
        ]

    return {"built_in": built_in, "custom": custom}
