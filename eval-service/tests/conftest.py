"""Shared fixtures for the evaluation service test suite.

Provides a FastAPI TestClient, mock overrides for Azure services,
and test data factories used across all test modules.
"""


def pytest_addoption(parser):
    """Register the --run-integration flag for integration tests."""
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="Run integration tests against live deployed eval service",
    )

import os
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Environment setup — prevent real Azure connections during testing
# ---------------------------------------------------------------------------

os.environ.setdefault("FOUNDRY_PROJECT_ENDPOINT", "https://test-endpoint.services.ai.azure.com/api/projects/test-project")
os.environ.setdefault("FOUNDRY_MODEL_DEPLOYMENT", "gpt-4.1-mini")
os.environ.setdefault("COSMOS_ENDPOINT", "https://test-cosmos.documents.azure.com:443/")
os.environ.setdefault("COSMOS_DATABASE", "test-db")
os.environ.setdefault("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=test-key")
os.environ.setdefault("LOG_LEVEL", "warning")


# ---------------------------------------------------------------------------
# Mock Azure clients
# ---------------------------------------------------------------------------

def _make_mock_openai_client():
    """Create a mock OpenAI-compatible client for eval API calls."""
    client = MagicMock()

    # Mock evals.create
    mock_eval = MagicMock()
    mock_eval.id = "eval_test_123"
    mock_eval.name = "Test Eval"
    client.evals.create.return_value = mock_eval

    # Mock evals.runs.create
    mock_run = MagicMock()
    mock_run.id = "evalrun_test_456"
    mock_run.status = "running"
    mock_run.report_url = "https://ai.azure.com/report/test"
    client.evals.runs.create.return_value = mock_run

    # Mock evals.runs.retrieve
    mock_completed_run = MagicMock()
    mock_completed_run.id = "evalrun_test_456"
    mock_completed_run.status = "completed"
    mock_completed_run.report_url = "https://ai.azure.com/report/test"
    mock_completed_run.result_counts = MagicMock(total=5, passed=4, failed=1, errored=0)
    mock_completed_run.per_testing_criteria_results = [
        MagicMock(testing_criteria="coherence", passed=4, failed=1, pass_rate=0.8),
    ]
    client.evals.runs.retrieve.return_value = mock_completed_run

    # Mock evals.runs.output_items.list
    mock_item = MagicMock()
    mock_item.id = "item_001"
    mock_item.status = "completed"
    mock_item.datasource_item = {"query": "test query", "response": "test response"}
    mock_item.results = [{"name": "coherence", "score": 4.0, "label": "pass", "passed": True}]
    client.evals.runs.output_items.list.return_value = [mock_item]

    # Mock evals.retrieve
    client.evals.retrieve.return_value = mock_eval

    # Mock evals.delete
    client.evals.delete.return_value = None

    return client


def _make_mock_project_client():
    """Create a mock AIProjectClient."""
    project_client = MagicMock()

    # Mock evaluation_rules
    mock_rule = MagicMock()
    mock_rule.id = "rule_test_789"
    mock_rule.display_name = "Test Rule"
    mock_rule.enabled = True
    mock_rule.event_type = "ResponseCompleted"
    project_client.evaluation_rules.create_or_update.return_value = mock_rule
    project_client.evaluation_rules.list.return_value = [mock_rule]

    # Mock beta.evaluators
    mock_evaluator = MagicMock()
    mock_evaluator.name = "test_custom_eval"
    mock_evaluator.version = "1"
    mock_evaluator.display_name = "Test Custom Eval"
    mock_evaluator.description = "A test custom evaluator"
    mock_evaluator.categories = ["quality"]
    project_client.beta.evaluators.create_version.return_value = mock_evaluator
    project_client.beta.evaluators.list.return_value = [mock_evaluator]
    project_client.beta.evaluators.delete_version.return_value = None

    # Mock beta.evaluation_taxonomies
    mock_taxonomy = MagicMock()
    mock_taxonomy.id = "taxonomy_test_001"
    project_client.beta.evaluation_taxonomies.create.return_value = mock_taxonomy

    # Mock get_openai_client
    project_client.get_openai_client.return_value = _make_mock_openai_client()

    return project_client


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _mock_azure_clients(monkeypatch):
    """Auto-mock all Azure SDK clients so no real connections are made."""
    mock_project = _make_mock_project_client()
    mock_openai = _make_mock_openai_client()

    monkeypatch.setattr("app.config.get_project_client", lambda: mock_project)
    monkeypatch.setattr("app.config.get_openai_client", lambda: mock_openai)

    # Clear the lru_cache on get_settings so env changes take effect
    from app.config import get_settings
    get_settings.cache_clear()

    yield {"project_client": mock_project, "openai_client": mock_openai}


@pytest.fixture
def client():
    """FastAPI TestClient with mocked Azure services."""
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def mock_openai():
    """Direct access to the mock OpenAI client."""
    return _make_mock_openai_client()


@pytest.fixture
def mock_project():
    """Direct access to the mock project client."""
    return _make_mock_project_client()


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_query_data():
    """Sample query-response pairs for dataset evaluation."""
    return [
        {"query": "What is the baggage allowance?", "response": "Economy class allows 30kg checked baggage."},
        {"query": "How do I request a wheelchair?", "response": "Request 48h before departure via Manage Booking."},
        {"query": "What are refund policies?", "response": "Refunds are processed within 7-14 business days."},
    ]


@pytest.fixture
def sample_query_data_with_context():
    """Sample data including context and ground_truth fields."""
    return [
        {
            "query": "What is the baggage allowance?",
            "response": "Economy class allows 30kg checked baggage.",
            "context": "Economy class: 30kg checked, 7kg hand luggage per QR policy.",
            "ground_truth": "Economy class passengers are allowed 30kg checked and 7kg hand luggage.",
        },
    ]


@pytest.fixture
def sample_response_log_entry():
    """Sample response log entry for testing."""
    return {
        "response_id": "resp_test_12345",
        "conversation_id": "conv_001",
        "agent_name": "Oryx",
        "user_query": "What is the baggage allowance for Economy class?",
        "response_text": "Economy class passengers are allowed 30kg checked baggage and 7kg hand luggage.",
        "tool_calls": [{"name": "knowledge_base_retrieve", "type": "function_call", "arguments": {}}],
        "timestamp": "2026-04-05T12:00:00Z",
        "has_kb_retrieval": True,
        "has_mcp_call": False,
        "loop_count": 1,
    }


@pytest.fixture
def sample_code_evaluator():
    """Sample code-based custom evaluator definition."""
    return {
        "name": "test_code_eval",
        "display_name": "Test Code Evaluator",
        "description": "A test evaluator that checks response length",
        "category": "quality",
        "code_text": 'def grade(sample: dict, item: dict) -> float:\n    r = item.get("response", "")\n    return 1.0 if len(r) > 10 else 0.0\n',
        "input_fields": ["response"],
        "pass_threshold": 0.5,
    }


@pytest.fixture
def sample_prompt_evaluator():
    """Sample prompt-based custom evaluator definition."""
    return {
        "name": "test_prompt_eval",
        "display_name": "Test Prompt Evaluator",
        "description": "A test evaluator that checks friendliness",
        "category": "quality",
        "prompt_text": 'Rate friendliness of the response.\n\nResponse:\n{{response}}\n\nOutput Format (JSON):\n{"result": <1-5>, "reason": "<explanation>"}',
        "input_fields": ["response"],
        "scoring_type": "ordinal",
        "min_value": 1,
        "max_value": 5,
        "threshold": 3,
    }
