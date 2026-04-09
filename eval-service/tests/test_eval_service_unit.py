"""Unit tests for the core evaluation service module.

Tests the EVALUATOR_REGISTRY, build_testing_criteria(), and the
eval run creator functions with mocked Azure clients.
"""

import pytest
from unittest.mock import patch, MagicMock
from app.services.eval_service import (
    EVALUATOR_REGISTRY,
    build_testing_criteria,
    create_eval_and_run_dataset,
    create_eval_and_run_response_ids,
    create_eval_and_run_agent_target,
    create_eval_and_run_synthetic,
    poll_eval_run,
)


# ===========================================================================
# EVALUATOR_REGISTRY tests
# ===========================================================================


class TestEvaluatorRegistry:
    """Validate the structure and completeness of the evaluator registry."""

    def test_registry_is_dict(self):
        assert isinstance(EVALUATOR_REGISTRY, dict)

    def test_registry_has_26_evaluators(self):
        assert len(EVALUATOR_REGISTRY) == 26

    def test_all_evaluators_have_required_fields(self):
        required_fields = {"evaluator_name", "requires_model", "data_mapping", "category", "modes"}
        for name, reg in EVALUATOR_REGISTRY.items():
            for field in required_fields:
                assert field in reg, f"Evaluator '{name}' missing field '{field}'"

    def test_all_evaluator_names_start_with_builtin(self):
        for name, reg in EVALUATOR_REGISTRY.items():
            assert reg["evaluator_name"].startswith("builtin."), \
                f"Evaluator '{name}' has name '{reg['evaluator_name']}' not starting with 'builtin.'"

    def test_all_categories_are_valid(self):
        valid_categories = {"quality", "rag", "safety", "agent", "similarity"}
        for name, reg in EVALUATOR_REGISTRY.items():
            assert reg["category"] in valid_categories, \
                f"Evaluator '{name}' has invalid category '{reg['category']}'"

    def test_all_modes_are_valid(self):
        valid_modes = {"dataset", "agent_target", "response_ids"}
        for name, reg in EVALUATOR_REGISTRY.items():
            for mode in reg["modes"]:
                assert mode in valid_modes, \
                    f"Evaluator '{name}' has invalid mode '{mode}'"

    def test_quality_evaluators_exist(self):
        quality = [n for n, r in EVALUATOR_REGISTRY.items() if r["category"] == "quality"]
        assert "coherence" in quality
        assert "fluency" in quality

    def test_safety_evaluators_exist(self):
        safety = [n for n, r in EVALUATOR_REGISTRY.items() if r["category"] == "safety"]
        assert "violence" in safety
        assert "hate_unfairness" in safety
        assert "sexual" in safety
        assert "self_harm" in safety
        assert "protected_material" in safety
        assert "indirect_attack" in safety

    def test_agent_evaluators_exist(self):
        agent = [n for n, r in EVALUATOR_REGISTRY.items() if r["category"] == "agent"]
        assert "task_adherence" in agent
        assert "task_completion" in agent
        assert "intent_resolution" in agent
        assert "tool_call_accuracy" in agent
        assert "tool_selection" in agent
        assert "tool_call_success" in agent

    def test_rag_evaluators_exist(self):
        rag = [n for n, r in EVALUATOR_REGISTRY.items() if r["category"] == "rag"]
        assert "groundedness" in rag
        assert "relevance" in rag
        assert "retrieval" in rag

    def test_similarity_evaluators_exist(self):
        sim = [n for n, r in EVALUATOR_REGISTRY.items() if r["category"] == "similarity"]
        assert "f1_score" in sim

    def test_red_team_only_evaluators(self):
        red_team = [n for n, r in EVALUATOR_REGISTRY.items() if r.get("red_team_only")]
        assert "prohibited_actions" in red_team
        assert "sensitive_data_leakage" in red_team
        assert len(red_team) == 2

    def test_red_team_evaluators_have_empty_modes(self):
        for name in ["prohibited_actions", "sensitive_data_leakage"]:
            assert EVALUATOR_REGISTRY[name]["modes"] == [], \
                f"Red-team evaluator '{name}' should have empty modes"

    def test_agent_evaluators_use_output_items(self):
        agent_evals = [n for n, r in EVALUATOR_REGISTRY.items() if r["category"] == "agent"]
        for name in agent_evals:
            assert EVALUATOR_REGISTRY[name].get("uses_output_items") is True, \
                f"Agent evaluator '{name}' should use output_items"

    def test_safety_evaluators_include_agent_target_mode(self):
        """Safety evaluators should work in agent_target mode (accept empty text)."""
        for name in ["violence", "hate_unfairness", "sexual", "self_harm", "protected_material", "indirect_attack"]:
            assert "agent_target" in EVALUATOR_REGISTRY[name]["modes"], \
                f"Safety evaluator '{name}' should support agent_target mode"

    def test_quality_evaluators_exclude_agent_target_mode(self):
        """Quality evaluators need response text — should NOT be in agent_target mode."""
        for name in ["coherence", "fluency"]:
            assert "agent_target" not in EVALUATOR_REGISTRY[name]["modes"], \
                f"Quality evaluator '{name}' should NOT support agent_target mode"

    def test_context_requiring_evaluators_are_dataset_only(self):
        """Evaluators needing context should only support dataset mode."""
        for name in ["groundedness", "groundedness_pro", "retrieval", "ungrounded_attributes"]:
            assert EVALUATOR_REGISTRY[name]["modes"] == ["dataset"], \
                f"Context-requiring evaluator '{name}' should be dataset-only"

    def test_data_mapping_contains_valid_template_vars(self):
        for name, reg in EVALUATOR_REGISTRY.items():
            for field, template in reg["data_mapping"].items():
                assert "{{" in template and "}}" in template, \
                    f"Evaluator '{name}' field '{field}' has invalid template: {template}"


# ===========================================================================
# build_testing_criteria() tests
# ===========================================================================


class TestBuildTestingCriteria:
    """Test the testing criteria builder function."""

    def test_basic_dataset_mode(self):
        criteria = build_testing_criteria(["coherence", "violence"], "gpt-4.1-mini", eval_mode="dataset")
        assert len(criteria) == 2
        names = [c["name"] for c in criteria]
        assert "coherence" in names
        assert "violence" in names

    def test_model_deployment_set_for_ai_assisted(self):
        criteria = build_testing_criteria(["coherence"], "gpt-4.1-mini", eval_mode="dataset")
        assert len(criteria) == 1
        assert criteria[0]["initialization_parameters"]["deployment_name"] == "gpt-4.1-mini"

    def test_no_model_deployment_for_non_ai_assisted(self):
        criteria = build_testing_criteria(["violence"], "gpt-4.1-mini", eval_mode="dataset")
        assert len(criteria) == 1
        assert "initialization_parameters" not in criteria[0]

    def test_skips_unknown_evaluators(self):
        criteria = build_testing_criteria(["coherence", "nonexistent_eval"], "gpt-4.1-mini", eval_mode="dataset")
        assert len(criteria) == 1
        assert criteria[0]["name"] == "coherence"

    def test_skips_red_team_only_evaluators(self):
        criteria = build_testing_criteria(
            ["violence", "prohibited_actions", "sensitive_data_leakage"],
            "gpt-4.1-mini",
            eval_mode="dataset",
        )
        assert len(criteria) == 1
        assert criteria[0]["name"] == "violence"

    def test_mode_filtering_agent_target(self):
        """In agent_target mode, quality evaluators should be filtered out."""
        criteria = build_testing_criteria(
            ["coherence", "violence", "task_adherence"],
            "gpt-4.1-mini",
            eval_mode="agent_target",
        )
        names = [c["name"] for c in criteria]
        assert "coherence" not in names  # quality — not in agent_target
        assert "violence" in names  # safety — in agent_target
        assert "task_adherence" in names  # agent — in agent_target

    def test_mode_filtering_response_ids(self):
        criteria = build_testing_criteria(
            ["coherence", "groundedness", "task_adherence"],
            "gpt-4.1-mini",
            eval_mode="response_ids",
        )
        names = [c["name"] for c in criteria]
        assert "coherence" in names  # quality — in response_ids
        assert "groundedness" not in names  # needs context — dataset only
        assert "task_adherence" in names  # agent — in response_ids

    def test_sample_output_substitution(self):
        """When use_sample_output=True, {{item.response}} should become {{sample.output_text}}."""
        criteria = build_testing_criteria(
            ["violence"],
            "gpt-4.1-mini",
            use_sample_output=True,
            eval_mode="agent_target",
        )
        assert len(criteria) == 1
        assert criteria[0]["data_mapping"]["response"] == "{{sample.output_text}}"

    def test_sample_output_preserves_output_items(self):
        """Agent evaluators should keep {{sample.output_items}} even with use_sample_output=True."""
        criteria = build_testing_criteria(
            ["task_adherence"],
            "gpt-4.1-mini",
            use_sample_output=True,
            eval_mode="agent_target",
        )
        assert len(criteria) == 1
        assert criteria[0]["data_mapping"]["response"] == "{{sample.output_items}}"

    def test_empty_evaluators_list(self):
        criteria = build_testing_criteria([], "gpt-4.1-mini", eval_mode="dataset")
        assert criteria == []

    def test_all_evaluators_in_dataset_mode(self):
        """Non-red-team evaluators with 'dataset' in modes should be included."""
        all_names = list(EVALUATOR_REGISTRY.keys())
        criteria = build_testing_criteria(all_names, "gpt-4.1-mini", eval_mode="dataset")
        # Count evaluators that have 'dataset' in their modes and are not red_team_only
        expected = sum(
            1 for reg in EVALUATOR_REGISTRY.values()
            if not reg.get("red_team_only") and "dataset" in reg.get("modes", [])
        )
        assert len(criteria) == expected

    def test_data_mapping_present(self):
        criteria = build_testing_criteria(["coherence"], "gpt-4.1-mini", eval_mode="dataset")
        assert "data_mapping" in criteria[0]
        assert "query" in criteria[0]["data_mapping"]
        assert "response" in criteria[0]["data_mapping"]

    def test_evaluator_name_uses_builtin_prefix(self):
        criteria = build_testing_criteria(["coherence"], "gpt-4.1-mini", eval_mode="dataset")
        assert criteria[0]["evaluator_name"] == "builtin.coherence"

    def test_type_field_always_azure_ai_evaluator(self):
        criteria = build_testing_criteria(["coherence", "violence", "f1_score"], "gpt-4.1-mini", eval_mode="dataset")
        for c in criteria:
            assert c["type"] == "azure_ai_evaluator"


# ===========================================================================
# Eval run creator tests (with mocked clients)
# ===========================================================================


class TestCreateEvalAndRunDataset:
    def test_returns_eval_and_run_ids(self):
        result = create_eval_and_run_dataset(
            name="Test Dataset Eval",
            items=[{"query": "test", "response": "test answer"}],
            evaluator_names=["coherence"],
            model_deployment="gpt-4.1-mini",
        )
        assert "eval_id" in result
        assert "run_id" in result
        assert "status" in result

    def test_accepts_multiple_items(self):
        items = [{"query": f"q{i}", "response": f"r{i}"} for i in range(10)]
        result = create_eval_and_run_dataset("Multi", items, ["violence"], "gpt-4.1-mini")
        assert result["eval_id"] == "eval_test_123"
        assert result["run_id"] == "evalrun_test_456"


class TestCreateEvalAndRunResponseIds:
    def test_returns_eval_and_run_ids(self):
        result = create_eval_and_run_response_ids(
            name="Test Response ID Eval",
            response_ids=["resp_001", "resp_002"],
            evaluator_names=["coherence", "violence"],
            model_deployment="gpt-4.1-mini",
        )
        assert result["eval_id"] == "eval_test_123"
        assert result["run_id"] == "evalrun_test_456"

    def test_single_response_id(self):
        result = create_eval_and_run_response_ids(
            name="Single ID",
            response_ids=["resp_single"],
            evaluator_names=["violence"],
            model_deployment="gpt-4.1-mini",
        )
        assert result["status"] == "running"


class TestCreateEvalAndRunAgentTarget:
    def test_returns_eval_and_run_ids(self):
        result = create_eval_and_run_agent_target(
            name="Test Agent Target",
            agent_name="Oryx",
            agent_version=None,
            queries=[{"query": "What is baggage allowance?"}],
            evaluator_names=["violence", "task_adherence"],
            model_deployment="gpt-4.1-mini",
        )
        assert result["eval_id"] == "eval_test_123"
        assert result["run_id"] == "evalrun_test_456"

    def test_with_agent_version(self):
        result = create_eval_and_run_agent_target(
            name="Versioned",
            agent_name="Oryx",
            agent_version="2",
            queries=[{"query": "test"}],
            evaluator_names=["task_adherence"],
            model_deployment="gpt-4.1-mini",
        )
        assert result["status"] == "running"


class TestCreateEvalAndRunSynthetic:
    def test_returns_eval_and_run_ids(self):
        result = create_eval_and_run_synthetic(
            name="Test Synthetic",
            agent_name="Oryx",
            agent_version=None,
            prompt="Generate customer service questions",
            samples_count=5,
            evaluator_names=["violence"],
            model_deployment="gpt-4.1-mini",
        )
        assert result["eval_id"] == "eval_test_123"
        assert result["run_id"] == "evalrun_test_456"


class TestPollEvalRun:
    def test_completed_run_returns_results(self):
        result = poll_eval_run("eval_test_123", "evalrun_test_456", timeout_seconds=5)
        assert result["status"] == "completed"
        assert result["report_url"] is not None
        assert result["result_counts"] is not None
        assert result["result_counts"]["total"] == 5
        assert result["result_counts"]["passed"] == 4

    def test_returns_per_evaluator_results(self):
        result = poll_eval_run("eval_test_123", "evalrun_test_456", timeout_seconds=5)
        assert result["per_evaluator"] is not None
        assert len(result["per_evaluator"]) > 0

    def test_returns_individual_items(self):
        result = poll_eval_run("eval_test_123", "evalrun_test_456", timeout_seconds=5)
        assert len(result["items"]) > 0
        assert result["items"][0]["id"] == "item_001"


# ===========================================================================
# Config module tests
# ===========================================================================


class TestConfig:
    def test_settings_returns_settings_object(self):
        from app.config import get_settings
        settings = get_settings()
        assert settings.VERSION == "1.0.0"
        assert settings.FOUNDRY_MODEL_DEPLOYMENT is not None

    def test_settings_cors_origins_is_list(self):
        from app.config import get_settings
        settings = get_settings()
        assert isinstance(settings.CORS_ORIGINS, list)
        assert len(settings.CORS_ORIGINS) > 0

    def test_settings_reads_environment_variables(self):
        from app.config import get_settings
        get_settings.cache_clear()
        settings = get_settings()
        assert "test-endpoint" in settings.FOUNDRY_PROJECT_ENDPOINT or "aikb-foundry" in settings.FOUNDRY_PROJECT_ENDPOINT
