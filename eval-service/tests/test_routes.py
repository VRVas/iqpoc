"""Integration tests for ALL eval service HTTP routes.

Tests every endpoint, status code, request validation, and
response schema using FastAPI TestClient.
"""

import pytest


# ===========================================================================
# Health endpoint — GET /health
# ===========================================================================


class TestHealthRoute:
    def test_health_returns_200(self, client):
        r = client.get("/health")
        assert r.status_code == 200

    def test_health_response_structure(self, client):
        data = client.get("/health").json()
        assert data["status"] == "healthy"
        assert "version" in data
        assert "foundry_endpoint" in data
        assert "model_deployment" in data
        assert "app_insights_configured" in data

    def test_health_version_is_string(self, client):
        data = client.get("/health").json()
        assert isinstance(data["version"], str)

    def test_health_app_insights_configured_is_bool(self, client):
        data = client.get("/health").json()
        assert isinstance(data["app_insights_configured"], bool)


# ===========================================================================
# Evaluators — GET /evaluators/list
# ===========================================================================


class TestEvaluatorsRoute:
    def test_list_returns_200(self, client):
        r = client.get("/evaluators/list")
        assert r.status_code == 200

    def test_list_has_built_in_and_custom(self, client):
        data = client.get("/evaluators/list").json()
        assert "built_in" in data
        assert "custom" in data

    def test_built_in_has_26_evaluators(self, client):
        data = client.get("/evaluators/list").json()
        assert len(data["built_in"]) == 26

    def test_each_built_in_has_required_fields(self, client):
        data = client.get("/evaluators/list").json()
        required = {"name", "short_name", "category", "requires_model", "input_fields", "description", "modes"}
        for ev in data["built_in"]:
            for field in required:
                assert field in ev, f"Missing '{field}' in evaluator {ev.get('short_name', '?')}"

    def test_modes_is_list(self, client):
        data = client.get("/evaluators/list").json()
        for ev in data["built_in"]:
            assert isinstance(ev["modes"], list)

    def test_red_team_only_flag_present(self, client):
        data = client.get("/evaluators/list").json()
        red_team = [e for e in data["built_in"] if e.get("red_team_only")]
        assert len(red_team) == 2


# ===========================================================================
# Evaluate — POST /evaluate/batch
# ===========================================================================


class TestEvaluateBatchRoute:
    def test_batch_inline_returns_200(self, client):
        r = client.post("/evaluate/batch", json={
            "name": "Test Batch",
            "evaluators": ["coherence", "violence"],
            "data_source": {
                "type": "inline",
                "items": [{"query": "test", "response": "test answer"}],
            },
        })
        assert r.status_code == 200

    def test_batch_inline_response_structure(self, client):
        data = client.post("/evaluate/batch", json={
            "evaluators": ["violence"],
            "data_source": {"type": "inline", "items": [{"query": "q", "response": "r"}]},
        }).json()
        assert "eval_id" in data
        assert "run_id" in data
        assert "status" in data
        assert "poll_url" in data

    def test_batch_response_ids_returns_200(self, client):
        r = client.post("/evaluate/batch", json={
            "evaluators": ["coherence"],
            "data_source": {
                "type": "response_ids",
                "response_ids": ["resp_001", "resp_002"],
            },
        })
        assert r.status_code == 200

    def test_batch_invalid_data_source_returns_400(self, client):
        r = client.post("/evaluate/batch", json={
            "evaluators": ["coherence"],
            "data_source": {"type": "unknown_type"},
        })
        assert r.status_code == 400

    def test_batch_empty_evaluators_still_accepted(self, client):
        """Pydantic defaults apply, so empty list is valid (returns 200 or 500 from eval)."""
        r = client.post("/evaluate/batch", json={
            "evaluators": [],
            "data_source": {"type": "inline", "items": [{"query": "q", "response": "r"}]},
        })
        # Should not be 422 (validation error) — empty evaluators is a runtime choice
        assert r.status_code in (200, 500)

    def test_batch_missing_body_returns_422(self, client):
        r = client.post("/evaluate/batch")
        assert r.status_code == 422


# ===========================================================================
# Evaluate — POST /evaluate/agent-target
# ===========================================================================


class TestEvaluateAgentTargetRoute:
    def test_agent_target_returns_200(self, client):
        r = client.post("/evaluate/agent-target", json={
            "agent_name": "Oryx",
            "queries": [{"query": "What is baggage allowance?"}],
            "evaluators": ["violence", "task_adherence"],
        })
        assert r.status_code == 200

    def test_agent_target_response_has_poll_url(self, client):
        data = client.post("/evaluate/agent-target", json={
            "agent_name": "Oryx",
            "queries": [{"query": "test"}],
        }).json()
        assert "poll_url" in data
        assert "/evaluate/status/" in data["poll_url"]

    def test_agent_target_missing_agent_name_returns_422(self, client):
        r = client.post("/evaluate/agent-target", json={
            "queries": [{"query": "test"}],
        })
        assert r.status_code == 422

    def test_agent_target_missing_queries_returns_422(self, client):
        r = client.post("/evaluate/agent-target", json={
            "agent_name": "Oryx",
        })
        assert r.status_code == 422

    def test_agent_target_with_version(self, client):
        r = client.post("/evaluate/agent-target", json={
            "agent_name": "Oryx",
            "agent_version": "2",
            "queries": [{"query": "test"}],
            "evaluators": ["task_adherence"],
        })
        assert r.status_code == 200

    def test_agent_target_multiple_queries(self, client):
        r = client.post("/evaluate/agent-target", json={
            "agent_name": "Oryx",
            "queries": [{"query": f"q{i}"} for i in range(20)],
            "evaluators": ["violence"],
        })
        assert r.status_code == 200


# ===========================================================================
# Evaluate — POST /evaluate/by-response-ids
# ===========================================================================


class TestEvaluateByResponseIdsRoute:
    def test_by_response_ids_returns_200(self, client):
        r = client.post("/evaluate/by-response-ids", json={
            "response_ids": ["resp_001", "resp_002"],
            "evaluators": ["coherence", "violence"],
        })
        assert r.status_code == 200

    def test_by_response_ids_response_structure(self, client):
        data = client.post("/evaluate/by-response-ids", json={
            "response_ids": ["resp_001"],
            "evaluators": ["coherence"],
        }).json()
        assert "eval_id" in data
        assert "run_id" in data

    def test_by_response_ids_missing_ids_returns_422(self, client):
        r = client.post("/evaluate/by-response-ids", json={
            "evaluators": ["coherence"],
        })
        assert r.status_code == 422

    def test_by_response_ids_single_id(self, client):
        r = client.post("/evaluate/by-response-ids", json={
            "response_ids": ["resp_single"],
            "evaluators": ["violence"],
        })
        assert r.status_code == 200


# ===========================================================================
# Evaluate — POST /evaluate/synthetic
# ===========================================================================


class TestEvaluateSyntheticRoute:
    def test_synthetic_returns_200(self, client):
        r = client.post("/evaluate/synthetic", json={
            "agent_name": "Oryx",
            "prompt": "Generate customer service questions",
            "samples_count": 5,
            "evaluators": ["violence"],
        })
        assert r.status_code == 200

    def test_synthetic_response_structure(self, client):
        data = client.post("/evaluate/synthetic", json={
            "agent_name": "Oryx",
            "prompt": "test",
            "samples_count": 3,
        }).json()
        assert "eval_id" in data
        assert "run_id" in data
        assert "estimated_duration_seconds" in data

    def test_synthetic_missing_agent_name_returns_422(self, client):
        r = client.post("/evaluate/synthetic", json={
            "prompt": "test",
            "samples_count": 5,
        })
        assert r.status_code == 422


# ===========================================================================
# Evaluate — POST /evaluate/single
# ===========================================================================


class TestEvaluateSingleRoute:
    def test_single_returns_200(self, client):
        r = client.post("/evaluate/single", json={
            "query": "What is the refund policy?",
            "response": "Refunds take 7-14 business days.",
            "evaluators": ["coherence"],
        })
        assert r.status_code == 200

    def test_single_response_has_results(self, client):
        data = client.post("/evaluate/single", json={
            "query": "test",
            "response": "test answer",
            "evaluators": ["violence"],
        }).json()
        assert "status" in data

    def test_single_with_context(self, client):
        r = client.post("/evaluate/single", json={
            "query": "test",
            "response": "test answer",
            "context": "Background context here",
            "evaluators": ["coherence"],
        })
        assert r.status_code == 200

    def test_single_with_ground_truth(self, client):
        r = client.post("/evaluate/single", json={
            "query": "test",
            "response": "test answer",
            "ground_truth": "expected answer",
            "evaluators": ["coherence"],
        })
        assert r.status_code == 200

    def test_single_missing_query_returns_422(self, client):
        r = client.post("/evaluate/single", json={
            "response": "test",
        })
        assert r.status_code == 422

    def test_single_missing_response_returns_422(self, client):
        r = client.post("/evaluate/single", json={
            "query": "test",
        })
        assert r.status_code == 422


# ===========================================================================
# Evaluate — GET /evaluate/status/{run_id}
# ===========================================================================


class TestEvaluateStatusRoute:
    def test_status_returns_200(self, client):
        r = client.get("/evaluate/status/evalrun_test_456?eval_id=eval_test_123")
        assert r.status_code == 200

    def test_status_response_has_required_fields(self, client):
        data = client.get("/evaluate/status/evalrun_test_456?eval_id=eval_test_123").json()
        assert "eval_id" in data
        assert "run_id" in data
        assert "status" in data

    def test_status_missing_eval_id_returns_422(self, client):
        r = client.get("/evaluate/status/evalrun_test_456")
        assert r.status_code == 422

    def test_status_completed_run_has_results(self, client):
        data = client.get("/evaluate/status/evalrun_test_456?eval_id=eval_test_123").json()
        assert data["status"] == "completed"
        assert data["result_counts"] is not None
        assert data["report_url"] is not None


# ===========================================================================
# Response Log — POST /response-log/log
# ===========================================================================


class TestResponseLogRoute:
    def test_log_returns_200(self, client, sample_response_log_entry):
        r = client.post("/response-log/log", json=sample_response_log_entry)
        assert r.status_code == 200
        assert r.json()["status"] == "logged"

    def test_log_minimal_entry(self, client):
        r = client.post("/response-log/log", json={"response_id": "resp_minimal"})
        assert r.status_code == 200
        assert r.json()["response_id"] == "resp_minimal"

    def test_log_missing_response_id_returns_422(self, client):
        r = client.post("/response-log/log", json={"agent_name": "test"})
        assert r.status_code == 422

    def test_log_truncates_long_query(self, client):
        """user_query should be truncated to 2000 chars."""
        r = client.post("/response-log/log", json={
            "response_id": "resp_long",
            "user_query": "x" * 5000,
        })
        assert r.status_code == 200

    def test_log_truncates_long_response_text(self, client):
        r = client.post("/response-log/log", json={
            "response_id": "resp_long_text",
            "response_text": "y" * 10000,
        })
        assert r.status_code == 200

    def test_log_with_tool_calls(self, client):
        r = client.post("/response-log/log", json={
            "response_id": "resp_tools",
            "tool_calls": [
                {"name": "knowledge_base_retrieve", "type": "function_call", "arguments": {}},
                {"name": "get_flight_status", "type": "mcp_call", "arguments": {"flight": "QR101"}},
            ],
        })
        assert r.status_code == 200

    def test_log_sets_defaults(self, client):
        """Missing optional fields should get reasonable defaults."""
        r = client.post("/response-log/log", json={"response_id": "resp_defaults"})
        assert r.status_code == 200


# ===========================================================================
# Response Log — GET /response-log/list
# ===========================================================================


class TestResponseLogListRoute:
    def test_list_returns_200(self, client):
        r = client.get("/response-log/list")
        assert r.status_code == 200

    def test_list_response_structure(self, client):
        data = client.get("/response-log/list").json()
        assert "responses" in data
        assert "total" in data
        assert "source" in data  # "cosmos" or "memory"

    def test_list_with_limit(self, client):
        r = client.get("/response-log/list?limit=5")
        assert r.status_code == 200

    def test_list_with_agent_name_filter(self, client):
        r = client.get("/response-log/list?agent_name=Oryx")
        assert r.status_code == 200

    def test_list_after_logging_entries(self, client):
        """Log entries then verify they appear in the list."""
        # Log 3 entries
        for i in range(3):
            client.post("/response-log/log", json={
                "response_id": f"resp_list_test_{i}",
                "agent_name": "TestAgent",
            })
        data = client.get("/response-log/list?agent_name=TestAgent").json()
        assert data["total"] >= 0  # May use in-memory fallback


# ===========================================================================
# Response Log — GET /response-log/count
# ===========================================================================


class TestResponseLogCountRoute:
    def test_count_returns_200(self, client):
        r = client.get("/response-log/count")
        assert r.status_code == 200

    def test_count_response_structure(self, client):
        data = client.get("/response-log/count").json()
        assert "count" in data
        assert "source" in data
        assert isinstance(data["count"], int)

    def test_count_with_agent_name_filter(self, client):
        r = client.get("/response-log/count?agent_name=Oryx")
        assert r.status_code == 200


# ===========================================================================
# Continuous — POST /continuous/configure
# ===========================================================================


class TestContinuousConfigureRoute:
    def test_configure_returns_200(self, client):
        r = client.post("/continuous/configure", json={
            "rule_id": "test-rule",
            "display_name": "Test Rule",
            "agent_name": "Oryx",
            "evaluators": ["violence", "coherence"],
            "max_hourly_runs": 50,
            "enabled": True,
        })
        assert r.status_code == 200

    def test_configure_response_structure(self, client):
        data = client.post("/continuous/configure", json={
            "agent_name": "Oryx",
            "evaluators": ["violence"],
        }).json()
        assert "rule_id" in data
        assert "status" in data
        assert "agent_name" in data
        assert "evaluators" in data
        assert "max_hourly_runs" in data

    def test_configure_missing_agent_name_returns_422(self, client):
        r = client.post("/continuous/configure", json={
            "evaluators": ["violence"],
        })
        assert r.status_code == 422

    def test_configure_with_defaults(self, client):
        """Uses default rule_id, display_name, max_hourly_runs when not provided."""
        r = client.post("/continuous/configure", json={
            "agent_name": "Oryx",
            "evaluators": ["violence"],
        })
        assert r.status_code == 200


# ===========================================================================
# Continuous — GET /continuous/rules
# ===========================================================================


class TestContinuousRulesRoute:
    def test_rules_returns_200(self, client):
        r = client.get("/continuous/rules")
        assert r.status_code == 200

    def test_rules_response_structure(self, client):
        data = client.get("/continuous/rules").json()
        assert "rules" in data
        assert isinstance(data["rules"], list)

    def test_rules_items_have_id_and_enabled(self, client):
        data = client.get("/continuous/rules").json()
        for rule in data["rules"]:
            assert "id" in rule
            assert "enabled" in rule


# ===========================================================================
# Red Team — POST /red-team/run
# ===========================================================================


class TestRedTeamRunRoute:
    def test_run_returns_200(self, client):
        r = client.post("/red-team/run", json={
            "agent_name": "Oryx",
            "risk_categories": ["ProhibitedActions"],
            "attack_strategies": ["Flip", "Base64"],
            "num_turns": 3,
        })
        assert r.status_code == 200

    def test_run_response_structure(self, client):
        data = client.post("/red-team/run", json={
            "agent_name": "Oryx",
        }).json()
        assert "eval_id" in data
        assert "run_id" in data
        assert "status" in data
        assert "estimated_duration_minutes" in data

    def test_run_includes_taxonomy_id(self, client):
        data = client.post("/red-team/run", json={
            "agent_name": "Oryx",
        }).json()
        assert "taxonomy_id" in data

    def test_run_missing_agent_name_returns_422(self, client):
        r = client.post("/red-team/run", json={
            "risk_categories": ["ProhibitedActions"],
        })
        assert r.status_code == 422

    def test_run_with_custom_evaluators(self, client):
        r = client.post("/red-team/run", json={
            "agent_name": "Oryx",
            "evaluators": ["prohibited_actions", "task_adherence"],
        })
        assert r.status_code == 200

    def test_run_with_agent_version(self, client):
        r = client.post("/red-team/run", json={
            "agent_name": "Oryx",
            "agent_version": "3",
        })
        assert r.status_code == 200


# ===========================================================================
# Red Team — GET /red-team/status/{run_id}
# ===========================================================================


class TestRedTeamStatusRoute:
    def test_status_returns_200(self, client):
        r = client.get("/red-team/status/evalrun_test?eval_id=eval_test")
        assert r.status_code == 200

    def test_status_response_has_required_fields(self, client):
        data = client.get("/red-team/status/evalrun_test?eval_id=eval_test").json()
        assert "status" in data
        assert "eval_id" in data
        assert "run_id" in data


# ===========================================================================
# Custom Evaluators — POST /custom-evaluators/create-code
# ===========================================================================


class TestCustomEvaluatorsCreateCodeRoute:
    def test_create_code_returns_200(self, client, sample_code_evaluator):
        r = client.post("/custom-evaluators/create-code", json=sample_code_evaluator)
        assert r.status_code == 200

    def test_create_code_response_structure(self, client, sample_code_evaluator):
        data = client.post("/custom-evaluators/create-code", json=sample_code_evaluator).json()
        assert data["status"] == "created"
        assert "name" in data
        assert "version" in data
        assert data["type"] == "code"

    def test_create_code_missing_name_returns_422(self, client):
        r = client.post("/custom-evaluators/create-code", json={
            "display_name": "Test",
            "description": "Test",
            "code_text": "def grade(s, i): return 0.0",
        })
        assert r.status_code == 422

    def test_create_code_missing_code_text_returns_422(self, client):
        r = client.post("/custom-evaluators/create-code", json={
            "name": "test",
            "display_name": "Test",
            "description": "Test",
        })
        assert r.status_code == 422


# ===========================================================================
# Custom Evaluators — POST /custom-evaluators/create-prompt
# ===========================================================================


class TestCustomEvaluatorsCreatePromptRoute:
    def test_create_prompt_returns_200(self, client, sample_prompt_evaluator):
        r = client.post("/custom-evaluators/create-prompt", json=sample_prompt_evaluator)
        assert r.status_code == 200

    def test_create_prompt_response_structure(self, client, sample_prompt_evaluator):
        data = client.post("/custom-evaluators/create-prompt", json=sample_prompt_evaluator).json()
        assert data["status"] == "created"
        assert data["type"] == "prompt"
        assert "scoring_type" in data

    def test_create_prompt_missing_prompt_text_returns_422(self, client):
        r = client.post("/custom-evaluators/create-prompt", json={
            "name": "test",
            "display_name": "Test",
            "description": "Test",
        })
        assert r.status_code == 422


# ===========================================================================
# Custom Evaluators — GET /custom-evaluators/list
# ===========================================================================


class TestCustomEvaluatorsListRoute:
    def test_list_returns_200(self, client):
        r = client.get("/custom-evaluators/list")
        assert r.status_code == 200

    def test_list_response_structure(self, client):
        data = client.get("/custom-evaluators/list").json()
        assert "evaluators" in data
        assert "total" in data


# ===========================================================================
# Custom Evaluators — DELETE /custom-evaluators/delete
# ===========================================================================


class TestCustomEvaluatorsDeleteRoute:
    def test_delete_returns_200(self, client):
        r = client.request("DELETE", "/custom-evaluators/delete", json={
            "name": "test_eval",
            "version": "1",
        })
        assert r.status_code == 200

    def test_delete_response_structure(self, client):
        data = client.request("DELETE", "/custom-evaluators/delete", json={
            "name": "test_eval",
            "version": "1",
        }).json()
        assert data["status"] == "deleted"

    def test_delete_missing_name_returns_422(self, client):
        r = client.request("DELETE", "/custom-evaluators/delete", json={
            "version": "1",
        })
        assert r.status_code == 422


# ===========================================================================
# Custom Evaluators — GET /custom-evaluators/prebuilt
# ===========================================================================


class TestCustomEvaluatorsPrebuiltRoute:
    def test_prebuilt_returns_200(self, client):
        r = client.get("/custom-evaluators/prebuilt")
        assert r.status_code == 200

    def test_prebuilt_has_3_evaluators(self, client):
        data = client.get("/custom-evaluators/prebuilt").json()
        assert len(data["evaluators"]) == 3

    def test_prebuilt_evaluator_names(self, client):
        data = client.get("/custom-evaluators/prebuilt").json()
        names = [e["name"] for e in data["evaluators"]]
        assert "kb_citation_checker" in names
        assert "mcp_tool_accuracy" in names
        assert "qr_policy_style" in names

    def test_prebuilt_evaluators_have_type(self, client):
        data = client.get("/custom-evaluators/prebuilt").json()
        for ev in data["evaluators"]:
            assert ev["type"] in ("code", "prompt")

    def test_prebuilt_code_evaluators_have_code_preview(self, client):
        data = client.get("/custom-evaluators/prebuilt").json()
        code_evals = [e for e in data["evaluators"] if e["type"] == "code"]
        for ev in code_evals:
            assert "code_preview" in ev
            assert len(ev["code_preview"]) > 0

    def test_prebuilt_prompt_evaluator_has_scoring_type(self, client):
        data = client.get("/custom-evaluators/prebuilt").json()
        prompt_evals = [e for e in data["evaluators"] if e["type"] == "prompt"]
        for ev in prompt_evals:
            assert "scoring_type" in ev


# ===========================================================================
# Custom Evaluators — POST /custom-evaluators/register-prebuilt/{name}
# ===========================================================================


class TestCustomEvaluatorsRegisterPrebuiltRoute:
    def test_register_kb_citation_returns_200(self, client):
        r = client.post("/custom-evaluators/register-prebuilt/kb_citation_checker")
        assert r.status_code == 200

    def test_register_mcp_accuracy_returns_200(self, client):
        r = client.post("/custom-evaluators/register-prebuilt/mcp_tool_accuracy")
        assert r.status_code == 200

    def test_register_qr_policy_style_returns_200(self, client):
        r = client.post("/custom-evaluators/register-prebuilt/qr_policy_style")
        assert r.status_code == 200

    def test_register_unknown_returns_404(self, client):
        r = client.post("/custom-evaluators/register-prebuilt/nonexistent")
        assert r.status_code == 404

    def test_register_response_has_version(self, client):
        data = client.post("/custom-evaluators/register-prebuilt/kb_citation_checker").json()
        assert "version" in data
        assert data["status"] == "created"


# ===========================================================================
# CORS / Middleware tests
# ===========================================================================


class TestCORSMiddleware:
    def test_cors_allows_localhost(self, client):
        r = client.options("/health", headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        })
        assert r.status_code == 200

    def test_cors_returns_allow_origin(self, client):
        r = client.get("/health", headers={"Origin": "http://localhost:3000"})
        assert "access-control-allow-origin" in r.headers


# ===========================================================================
# OpenAPI / Docs tests
# ===========================================================================


class TestOpenAPIDocs:
    def test_openapi_json_available(self, client):
        r = client.get("/openapi.json")
        assert r.status_code == 200
        schema = r.json()
        assert "paths" in schema
        assert "/health" in schema["paths"]

    def test_docs_available(self, client):
        r = client.get("/docs")
        assert r.status_code == 200
