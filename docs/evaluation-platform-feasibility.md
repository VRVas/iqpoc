# Evaluation Platform: Feasibility Analysis & Architecture Plan

> **Date:** April 5, 2026  
> **Project:** Foundry IQ Demo — Qatar Airways Contact Center Assistant  
> **Author:** AI Agent (GitHub Copilot)

---

## Our Current Stack vs. Evaluation Requirements

| Component | Technology | Evaluation-Ready? |
|---|---|---|
| **App framework** | Next.js 14 (TypeScript) | ⚠️ Partial — Foundry eval SDK is Python-only |
| **Agent runtime** | Foundry Agents v2 (Responses API) | ✅ Yes — `response_id` returned on every call |
| **Knowledge retrieval** | Azure AI Search KBs (`test41mini`, etc.) | ✅ Yes — RAG evaluators apply |
| **Code Interpreter** | Foundry built-in tool | ✅ Yes — agent evaluators apply |
| **MCP Airport Ops** | Custom MCP server (Container App) | ⚠️ Partial — tool call evaluators apply, but custom tool semantics need custom evaluators |
| **Tracing** | None currently | ❌ No — needs Application Insights + OpenTelemetry setup |
| **Monitoring** | None currently | ❌ No — needs Foundry project connection to App Insights |

---

## What We CAN Evaluate

### Tier 1: Available Now (API-driven, no Python required)

These use the Foundry REST API directly — we can call them from our TypeScript API routes:

| Evaluator Category | Specific Evaluators | What It Measures | Data Source |
|---|---|---|---|
| **Agent Response Eval** | Run evals on specific `response_id`s | Post-hoc quality analysis | `azure_ai_responses` — we already capture `x-response-id` from every Foundry call |
| **Azure OpenAI Graders** | `model_grader_string_check`, `model_grader_text_similarity`, `model_grader_labeler`, `model_grader_scorer` | Custom scoring via GPT | Any text input/output pair |

**How:** The Foundry Evals API (`/evals`, `/evals/runs`) is a REST API. We can create eval definitions, submit runs, and poll results from TypeScript. No Python needed.

**Key insight:** Every conversation turn in our app returns a `response_id`. We store these. We can batch-evaluate any set of responses at any time.

### Tier 2: Requires Python Sidecar/Script (Foundry SDK is Python-only)

The `azure-ai-projects` SDK and `azure-ai-evaluation` SDK are **Python-only**. These evaluators require Python:

| Category | Evaluators | Real-time? | Batch? |
|---|---|---|---|
| **RAG Quality** | `RetrievalEvaluator`, `GroundednessEvaluator`, `GroundednessProEvaluator`, `RelevanceEvaluator`, `ResponseCompletenessEvaluator`, `DocumentRetrievalEvaluator` | ❌ Too slow (5-15s per eval) | ✅ Yes |
| **General Quality** | `CoherenceEvaluator`, `FluencyEvaluator` | ❌ Too slow | ✅ Yes |
| **Agent-Specific** | `TaskAdherenceEvaluator`, `IntentResolutionEvaluator`, `ToolCallAccuracyEvaluator`, `ToolSelectionEvaluator`, `ToolInputAccuracyEvaluator`, `ToolOutputUtilizationEvaluator`, `ToolCallSuccessEvaluator`, `TaskCompletionEvaluator`, `TaskNavigationEfficiencyEvaluator` | ❌ Too slow | ✅ Yes |
| **Content Safety** | `ViolenceEvaluator`, `HateUnfairnessEvaluator`, `SexualEvaluator`, `SelfHarmEvaluator`, `ProtectedMaterialEvaluator`, `CodeVulnerabilityEvaluator` | ⚠️ Near-real-time possible for safety-critical | ✅ Yes |
| **Textual Similarity** | `SimilarityEvaluator`, `F1ScoreEvaluator`, `BleuScoreEvaluator`, `RougeScoreEvaluator`, `MeteorScoreEvaluator`, `GleuScoreEvaluator` | ❌ Needs ground truth | ✅ Yes |

### Tier 3: Continuous Evaluation (Foundry-native, zero code)

Foundry supports **Evaluation Rules** — automatic evaluation on sampled production traffic:

```
Event: RESPONSE_COMPLETED → Filter by agent_name → Run eval → Store results
```

- **What it does:** Automatically evaluates a % of live agent responses using any configured evaluator
- **Config:** `max_hourly_runs` (default 100), filter by agent name
- **Requirement:** Project managed identity needs `Azure AI User` role
- **Real-time?** Near-real-time (runs async after each response)

This is the **most powerful** option for production monitoring — but requires the Foundry project to be connected to Application Insights.

### Tier 4: Red Teaming (Batch only, Python required)

| Capability | Attack Strategies | What It Tests |
|---|---|---|
| **Content Safety Red Team** | Jailbreak, Crescendo, Multi-turn, Base64, Caesar cipher, Leetspeak, ASCII smuggling, Indirect Prompt Injection (XPIA), + 14 more | Can the agent be tricked into generating harmful content? |
| **Agentic Red Team** | Sensitive Data Leakage, Prohibited Actions, Task Adherence violations, Tool manipulation | Can the agent be manipulated into taking wrong actions? |

---

## What's Real-Time vs. Batch

| Timing | Mechanism | Evaluators | Latency |
|---|---|---|---|
| **Real-time (in-request)** | TypeScript API route calls Foundry Evals REST API | Azure OpenAI Graders (string check, labeler) | 1-3s added to response |
| **Near-real-time (post-response)** | Foundry Continuous Evaluation Rules | Any built-in evaluator | 5-30s after response, async |
| **Near-real-time (app-side)** | Fire-and-forget from our API route to a Python Azure Function | Content Safety evaluators | 5-15s, async |
| **Batch (scheduled)** | Python script/Azure Function on timer | All evaluators, Red Teaming | Minutes to hours |
| **On-demand (user-triggered)** | UI button → Python Azure Function | Any evaluator set | 10-60s depending on dataset size |

---

## Prerequisites & What We Need to Build

### Infrastructure Prerequisites

| Requirement | Status | Action Needed |
|---|---|---|
| **Application Insights** connected to Foundry project | ❌ Not set up | Create App Insights resource, link to Foundry project |
| **OpenTelemetry tracing** from our app | ❌ Not set up | Add `@opentelemetry/sdk-node` + `@azure/monitor-opentelemetry-exporter` to Next.js |
| **Python runtime** for SDK-based evaluators | ❌ Not available | Deploy a lightweight Azure Function App (Python 3.10+) as eval service |
| **Foundry project MI** with `Azure AI User` role | ⚠️ Need to verify | Check and assign role for continuous eval |
| **Storage for eval results** | ❌ Not set up | Can use existing Cosmos DB or a new Table Storage |

### Software Components to Build

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVALUATION SUBPLATFORM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────┐ │
│  │  TypeScript Layer │   │  Python Layer    │   │ Foundry-Native│ │
│  │  (Next.js routes) │   │  (Azure Function)│   │ (Config only) │ │
│  ├──────────────────┤   ├──────────────────┤   ├──────────────┤ │
│  │ • Response ID     │   │ • RAG evaluators │   │ • Continuous  │ │
│  │   capture & store │   │ • Agent evals    │   │   Eval Rules  │ │
│  │ • OpenTelemetry   │   │ • Safety evals   │   │ • Monitoring  │ │
│  │   span emission   │   │ • Red teaming    │   │   Dashboard   │ │
│  │ • Grader API calls│   │ • Batch runs     │   │ • Alerts      │ │
│  │ • Eval UI pages   │   │ • Custom evals   │   │               │ │
│  │ • Results display │   │ • Result export  │   │               │ │
│  └────────┬─────────┘   └────────┬─────────┘   └──────┬───────┘ │
│           │                       │                      │         │
│           ▼                       ▼                      ▼         │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              Application Insights (Unified Sink)            │   │
│  │         Traces + Eval Results + Metrics + Alerts            │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### Component 1: Response Capture (TypeScript — in our app)

Already partially done — we return `x-response-id` and `x-conversation-id`. Need to:
- Store every `response_id` + `conversation_id` + `agent_name` + timestamp in a local DB/table
- Store the user query and agent response text for offline eval
- Emit OpenTelemetry spans with `gen_ai.*` semantic conventions

#### Component 2: Real-Time Graders (TypeScript — in our app)

For lightweight, in-request evaluation:
- Call Foundry Evals REST API with `model_grader_labeler` or `model_grader_scorer`
- Example: grade every response for "did the agent cite sources?" (string check)
- Example: score every response for relevance (model scorer)
- Display score badges in the chat UI

#### Component 3: Python Eval Service (Azure Function App)

A small Python Function App with HTTP triggers:
- `/evaluate-batch` — accepts a list of response IDs, runs configured evaluators, returns results
- `/evaluate-single` — accepts query + response + context, runs evaluators, returns scores
- `/red-team` — runs adversarial probing against a specified agent
- `/configure-continuous` — sets up/modifies Foundry Evaluation Rules

**Required Python packages:**
```
azure-ai-projects
azure-ai-evaluation
azure-identity
opentelemetry-sdk
azure-monitor-opentelemetry
```

#### Component 4: Eval UI Pages (TypeScript — in our app)

New admin-only pages:
- `/evaluations` — dashboard showing eval history, scores over time, pass/fail rates
- `/evaluations/run` — trigger a batch eval run (select agent, evaluators, date range)
- `/evaluations/results/[id]` — detailed results for a specific eval run
- `/evaluations/continuous` — configure continuous eval rules
- `/evaluations/red-team` — trigger and view red team results

#### Component 5: Foundry-Native Configuration

Done via Azure CLI / REST API (no code in our app):
- Create Evaluation Rules for continuous monitoring
- Link App Insights to Foundry project
- Configure monitoring dashboard in Foundry portal

---

## Evaluator Mapping to Our Tools

| Our Tool | Applicable Evaluators | Why |
|---|---|---|
| **KB Retrieval** (Azure AI Search) | Retrieval, Document Retrieval, Groundedness, Groundedness Pro, Relevance, Response Completeness | RAG pipeline — does the agent use retrieved docs correctly? |
| **Code Interpreter** (Plotly graphs) | Tool Call Accuracy, Tool Selection, Tool Input Accuracy, Tool Output Utilization, Task Completion | Does the agent choose Code Interpreter correctly and produce valid visualizations? |
| **MCP Airport Ops** (custom) | Tool Call Accuracy, Tool Selection, Tool Input Accuracy, Tool Call Success + **Custom evaluator** for domain-specific correctness | Does the agent pass valid parameters? Does it interpret flight data correctly? Need custom eval for domain accuracy |
| **Multi-tool orchestration** | Task Adherence, Task Navigation Efficiency, Intent Resolution | Does the agent use the right combination of tools? Does it follow the system prompt? |
| **Overall quality** | Coherence, Fluency, Content Safety (all 6) | Baseline quality and safety on every response |

---

## Recommended Implementation Phases

### Phase 1 (Week 1): Foundation
- Set up Application Insights + link to Foundry project
- Add OpenTelemetry to our Next.js app (spans for every `/api/foundry/responses` call)
- Build response capture store (every response_id + metadata → Cosmos DB or Table Storage)
- Build `/evaluations` admin page (read-only dashboard placeholder)

### Phase 2 (Week 2): Real-Time Graders + Python Service
- Deploy Python Azure Function App with `azure-ai-evaluation` SDK
- Implement batch eval endpoint (accept response IDs → run evaluators → return results)
- Add real-time grader calls from TypeScript (lightweight, in-request scoring)
- Build `/evaluations/run` page (trigger batch evals from UI)

### Phase 3 (Week 3): Continuous Evaluation + Dashboard
- Configure Foundry Evaluation Rules for continuous monitoring
- Build `/evaluations/results/[id]` page (detailed drill-down)
- Add score badges to chat UI (real-time quality indicators)
- Wire up charts and trends on the dashboard

### Phase 4 (Week 4): Red Teaming + Advanced
- Implement red team endpoint in Python Function
- Build `/evaluations/red-team` page
- Add custom evaluators for MCP domain accuracy
- Configure alerts for safety threshold breaches

---

## Key Architectural Decision

**The critical gap:** Foundry's evaluation SDK is **Python-only**. Our app is TypeScript. We have three options:

1. **Python Azure Function sidecar** (recommended) — deploys alongside our app, called via HTTP. Clean separation, scales independently, full SDK access.

2. **Python scripts run manually/scheduled** — simplest for batch eval, but no UI integration. Good for Phase 1 proof of concept.

3. **REST API only (no Python)** — limited to Azure OpenAI Graders and Foundry Evals REST API. Covers ~30% of evaluators. Miss all agent-specific and RAG evaluators.

**Recommendation:** Option 1. A small Python Function App gives us full evaluator access while keeping our TypeScript app unchanged. The eval UI in our app calls the Python Function via HTTP — same pattern as our MCP server.
