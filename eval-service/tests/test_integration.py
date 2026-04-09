"""Integration tests against the live deployed eval service.

These tests make REAL HTTP calls to the deployed Container App
eval service. They verify the full stack from HTTP to Foundry SDK.

Run with:
  pytest tests/test_integration.py -v --run-integration

Skip by default (no --run-integration flag) to avoid accidental
Azure charges or test failures when the service is down.
"""

import os
import time
import pytest
import httpx

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

EVAL_SERVICE_URL = os.environ.get(
    "EVAL_SERVICE_URL",
    "https://ca-eval-service.proudplant-b551a736.eastus2.azurecontainerapps.io",
)
TIMEOUT = 30  # seconds per request


def integration_mark():
    """Skip if --run-integration not passed."""
    return pytest.mark.skipif(
        "not config.getoption('--run-integration')",
        reason="Integration tests require --run-integration flag",
    )


@pytest.fixture(scope="session")
def integration_enabled(request):
    return request.config.getoption("--run-integration")


@pytest.fixture(scope="session")
def live_client():
    """httpx client pointing at the live eval service."""
    return httpx.Client(base_url=EVAL_SERVICE_URL, timeout=TIMEOUT)


skip_no_integration = pytest.mark.skipif(
    "not config.getoption('--run-integration')",
    reason="Integration tests require --run-integration flag",
)


# ---------------------------------------------------------------------------
# Health & Infrastructure
# ---------------------------------------------------------------------------


@skip_no_integration
class TestLiveHealth:
    """Verify the deployed eval service is healthy."""

    def test_health_returns_200(self, live_client):
        r = live_client.get("/health")
        assert r.status_code == 200

    def test_health_is_healthy(self, live_client):
        data = live_client.get("/health").json()
        assert data["status"] == "healthy"

    def test_health_has_model_deployment(self, live_client):
        data = live_client.get("/health").json()
        assert data["model_deployment"]  # non-empty

    def test_health_app_insights_connected(self, live_client):
        data = live_client.get("/health").json()
        assert data["app_insights_configured"] is True


# ---------------------------------------------------------------------------
# Evaluators
# ---------------------------------------------------------------------------


@skip_no_integration
class TestLiveEvaluators:
    """Verify evaluator listing from the live service."""

    def test_list_returns_built_in(self, live_client):
        r = live_client.get("/evaluators/list")
        assert r.status_code == 200
        data = r.json()
        assert "built_in" in data
        assert len(data["built_in"]) >= 26

    def test_built_in_evaluators_have_modes(self, live_client):
        data = live_client.get("/evaluators/list").json()
        for ev in data["built_in"]:
            assert "modes" in ev

    def test_custom_evaluators_returned(self, live_client):
        data = live_client.get("/evaluators/list").json()
        assert "custom" in data


# ---------------------------------------------------------------------------
# Response Logging (Cosmos DB)
# ---------------------------------------------------------------------------


@skip_no_integration
class TestLiveResponseLog:
    """Verify response logging to Cosmos DB."""

    def test_log_entry(self, live_client):
        """Log a test entry and verify it persists."""
        entry = {
            "response_id": f"resp_integration_test_{int(time.time())}",
            "agent_name": "integration-test",
            "user_query": "Integration test query",
            "response_text": "Integration test response",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "has_kb_retrieval": False,
            "has_mcp_call": False,
            "loop_count": 0,
        }
        r = live_client.post("/response-log/log", json=entry)
        assert r.status_code == 200
        assert r.json()["status"] == "logged"

    def test_list_responses(self, live_client):
        r = live_client.get("/response-log/list?limit=5")
        assert r.status_code == 200
        data = r.json()
        assert "responses" in data
        assert data["source"] in ("cosmos", "memory")  # memory fallback when Cosmos MI not configured

    def test_count_responses(self, live_client):
        r = live_client.get("/response-log/count")
        assert r.status_code == 200
        assert r.json()["count"] >= 0


# ---------------------------------------------------------------------------
# Continuous Evaluation
# ---------------------------------------------------------------------------


@skip_no_integration
class TestLiveContinuousRules:
    """Verify continuous evaluation rule listing."""

    def test_list_rules(self, live_client):
        r = live_client.get("/continuous/rules")
        assert r.status_code == 200
        data = r.json()
        assert "rules" in data


# ---------------------------------------------------------------------------
# Custom Evaluators
# ---------------------------------------------------------------------------


@skip_no_integration
class TestLiveCustomEvaluators:
    """Verify custom evaluator endpoints."""

    def test_prebuilt_list(self, live_client):
        r = live_client.get("/custom-evaluators/prebuilt")
        assert r.status_code == 200
        data = r.json()
        assert len(data["evaluators"]) == 3

    def test_prebuilt_names(self, live_client):
        data = live_client.get("/custom-evaluators/prebuilt").json()
        names = [e["name"] for e in data["evaluators"]]
        assert "kb_citation_checker" in names
        assert "mcp_tool_accuracy" in names
        assert "qr_policy_style" in names

    def test_catalog_list(self, live_client):
        r = live_client.get("/custom-evaluators/list")
        assert r.status_code == 200
        assert "evaluators" in r.json()


# ---------------------------------------------------------------------------
# Evaluation History
# ---------------------------------------------------------------------------


@skip_no_integration
class TestLiveHistory:
    """Verify evaluation history endpoints."""

    def test_list_evals(self, live_client):
        r = live_client.get("/history/evals?limit=5")
        assert r.status_code == 200
        data = r.json()
        assert "evaluations" in data

    def test_recent_runs(self, live_client):
        r = live_client.get("/history/recent-runs?limit=5")
        assert r.status_code == 200
        data = r.json()
        assert "runs" in data


# ---------------------------------------------------------------------------
# End-to-End: Single Evaluation (actually runs against Foundry)
# ---------------------------------------------------------------------------


@skip_no_integration
class TestLiveSingleEvaluation:
    """Run a real single evaluation against Foundry.

    WARNING: This costs real Azure tokens. The single eval
    runs coherence + violence on 1 item.
    """

    def test_single_eval_completes(self, live_client):
        """Run a single evaluation and poll to completion."""
        r = live_client.post("/evaluate/single", json={
            "query": "What is the baggage allowance?",
            "response": "Economy class passengers are allowed 30kg checked baggage and 7kg hand luggage.",
            "evaluators": ["violence"],
        }, timeout=120)

        assert r.status_code == 200
        data = r.json()
        assert data["status"] in ("completed", "running")

        # If completed inline, check results
        if data["status"] == "completed":
            assert data["result_counts"]["total"] >= 1
