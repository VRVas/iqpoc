# Evaluation & Observability Platform — Detailed Design & Implementation Plan

> **Date:** April 5, 2026  
> **Project:** Foundry IQ Demo — Qatar Airways Contact Center Assistant  
> **Scope:** End-to-end evaluation subplatform using Azure Foundry Observability  
> **Decision:** Python Azure Container App as evaluation service (Option 1)

---

## 1. Architecture Decision: Why Container App, Not Function App

### Function App vs. Container App vs. Standalone App

| Factor | Azure Function App | Azure Container App | Standalone App (App Service) |
|---|---|---|---|
| **Cold start** | 5-30s (Flex Consumption) | 0s (min replicas=1) or ~5s (scale-to-zero) | 0s (always on) |
| **Long-running jobs** | ⚠️ 10 min max (Consumption), 60 min (Dedicated) | ✅ No timeout | ✅ No timeout |
| **Red teaming runs** | ❌ Too long (30-60 min) | ✅ Perfect | ✅ Perfect |
| **Cost** | Pay-per-execution | Pay-per-second + min replicas | Fixed monthly |
| **Existing pattern** | Already have `func-pizza-api` (Flights API) | Already have `ca-pizza-mcp` (MCP server) | None in project |
| **Python SDK compat** | ✅ Supports Python 3.10+ | ✅ Full Docker control | ✅ Full control |
| **Scaling** | Auto (per-trigger) | Auto (per-HTTP/KEDA) | Manual |
| **VNet integration** | ✅ Already set up in this RG | ✅ Via Container Apps Environment | ✅ Via VNet integration |

**Decision: Azure Container App.**

Reasons:
1. **Red teaming runs can take 30-60 minutes** — Function Apps time out.
2. **Batch evaluation runs** process hundreds of responses — need sustained compute.
3. **Container App pattern already exists** in our RG (`ca-pizza-mcp-onlgvc76rbuge`), deployed via the same Container Apps Environment (`cae-onlgvc76rbuge`).
4. **No cold start concerns** — set min replicas to 1 for always-warm, or 0 for cost savings with ~5s cold start.
5. **Full Docker control** — pin exact Python version, pre-install all SDK packages in image.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                                         │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                    Next.js App (TypeScript)                             │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ /agents  │  │ /test    │  │ /agent-      │  │ /evaluations     │  │  │
│  │  │          │  │          │  │  builder     │  │ (NEW - admin)    │  │  │
│  │  └──────────┘  └──────────┘  └──────┬───────┘  └────────┬─────────┘  │  │
│  │                                      │                    │            │  │
│  │  ┌──────────────────────────────────┴────────────────────┴─────────┐  │  │
│  │  │                    API Routes (Next.js)                          │  │  │
│  │  │  /api/foundry/responses  ──────────────────┐                    │  │  │
│  │  │  /api/eval/trigger       ──────────────────┤  (TypeScript)      │  │  │
│  │  │  /api/eval/results       ──────────────────┤                    │  │  │
│  │  │  /api/eval/history       ──────────────────┤                    │  │  │
│  │  │  /api/eval/configure     ──────────────────┘                    │  │  │
│  │  └────────────┬───────────────────┬────────────────────────────────┘  │  │
│  └───────────────┼───────────────────┼────────────────────────────────────┘  │
└──────────────────┼───────────────────┼──────────────────────────────────────┘
                   │                   │
    ┌──────────────▼────────┐  ┌───────▼─────────────────────────────────┐
    │   Foundry Agent       │  │   Evaluation Service                     │
    │   Service (v2 API)    │  │   (Python Container App)                 │
    │                       │  │                                           │
    │  • Responses API      │  │   Endpoints:                             │
    │  • Conversations API  │  │   POST /evaluate/batch                   │
    │  • Agent CRUD         │  │   POST /evaluate/single                  │
    │                       │  │   POST /evaluate/continuous/configure     │
    │  Returns:             │  │   POST /red-team/run                     │
    │  • response_id ◄──────┼──┼── POST /evaluate/by-response-ids        │
    │  • conversation_id    │  │   GET  /evaluate/status/{run_id}         │
    │                       │  │   GET  /evaluators/list                  │
    └──────────┬────────────┘  │   POST /evaluate/custom                  │
               │               │   GET  /health                           │
               │               │                                           │
               │               │   Uses:                                   │
               │               │   • azure-ai-projects SDK                 │
               │               │   • azure-ai-evaluation SDK               │
               │               │   • Foundry Evals API (OpenAI compat)     │
               │               │   • PyRIT (red teaming)                   │
               │               └─────────────┬─────────────────────────────┘
               │                             │
               ▼                             ▼
    ┌──────────────────────────────────────────────────────────────────────┐
    │                    Application Insights                               │
    │              (Connected to Foundry Project)                           │
    │                                                                       │
    │   Stores:                                                             │
    │   • Server-side agent traces (automatic from Foundry)                 │
    │   • Client-side traces (from our app via OpenTelemetry)               │
    │   • Evaluation results (from eval runs)                               │
    │   • Continuous evaluation scores                                      │
    │   • Red teaming ASR metrics                                           │
    │   • Custom metrics and alerts                                         │
    └──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Evaluation Service (Python Container App) — Detailed Design

### 3.1 Project Structure

```
eval-service/
├── Dockerfile
├── requirements.txt
├── pyproject.toml
├── README.md
├── .env.example
│
├── app/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app entry point
│   ├── config.py                  # Environment config + Foundry client setup
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── health.py              # GET /health
│   │   ├── evaluate.py            # Batch + single evaluation endpoints
│   │   ├── continuous.py          # Continuous evaluation rule management
│   │   ├── red_team.py            # Red teaming endpoints
│   │   ├── evaluators.py          # List available evaluators
│   │   └── results.py             # Query evaluation results
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── eval_service.py        # Core evaluation logic
│   │   ├── continuous_service.py  # Continuous eval rule CRUD
│   │   ├── red_team_service.py    # Red teaming orchestration
│   │   ├── response_service.py    # Fetch responses by ID from Foundry
│   │   └── custom_evaluators.py   # Domain-specific evaluators (MCP accuracy, KB citation)
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   ├── requests.py            # Pydantic request models
│   │   └── responses.py           # Pydantic response models
│   │
│   └── evaluators/
│       ├── __init__.py
│       ├── kb_citation_eval.py    # Custom: does the agent cite KB sources?
│       ├── mcp_accuracy_eval.py   # Custom: are MCP tool calls domain-correct?
│       └── qr_policy_eval.py      # Custom: does the response follow QR policy style?
│
├── tests/
│   ├── test_evaluate.py
│   ├── test_continuous.py
│   └── test_red_team.py
│
└── infra/
    ├── deploy.sh                  # az containerapp create/update
    └── bicep/                     # Optional IaC
```

### 3.2 Technology Stack

```
Python 3.11
FastAPI 0.115+
uvicorn

# Foundry SDKs
azure-ai-projects >= 2.0.0
azure-ai-evaluation >= 1.0.0
azure-identity

# OpenTelemetry
opentelemetry-sdk
azure-monitor-opentelemetry
azure-core-tracing-opentelemetry

# Red teaming
pyrit  # Microsoft's Python Risk Identification Tool

# Utilities
pydantic >= 2.0
httpx
python-dotenv
```

### 3.3 API Contract — Full Endpoint Specification

#### `POST /evaluate/batch`

Trigger a batch evaluation run on a set of response IDs or a dataset.

```json
// Request
{
  "name": "Weekly quality check",
  "agent_name": "agent-1774946608254",
  "evaluators": ["coherence", "groundedness", "violence", "task_adherence", "tool_call_accuracy"],
  "model_deployment": "gpt-4.1-mini",
  "data_source": {
    "type": "response_ids",          // or "dataset_file", "inline"
    "response_ids": ["resp_abc123", "resp_def456", "resp_ghi789"]
  }
}

// Response
{
  "eval_id": "eval_abc123",
  "run_id": "evalrun_xyz789",
  "status": "running",
  "poll_url": "/evaluate/status/evalrun_xyz789",
  "estimated_duration_seconds": 120
}
```

#### `POST /evaluate/single`

Evaluate a single query-response pair immediately (synchronous, for near-real-time).

```json
// Request
{
  "query": "What are the baggage allowances for Economy?",
  "response": "Economy passengers on Qatar Airways...",
  "context": "Retrieved from KB: qr-docs...",       // optional, for RAG evaluators
  "ground_truth": "30kg checked + 7kg carry-on",    // optional, for similarity
  "evaluators": ["coherence", "groundedness", "relevance"],
  "model_deployment": "gpt-4.1-mini"
}

// Response
{
  "results": [
    {"evaluator": "coherence", "score": 4.0, "label": "pass", "reason": "Well-structured...", "threshold": 3},
    {"evaluator": "groundedness", "score": 5.0, "label": "pass", "reason": "Fully grounded in context...", "threshold": 3},
    {"evaluator": "relevance", "score": 4.0, "label": "pass", "reason": "Directly answers the query...", "threshold": 3}
  ],
  "overall_pass": true,
  "duration_ms": 3200
}
```

#### `POST /evaluate/by-response-ids`

Evaluate specific Foundry response IDs (leverages Foundry's agent response evaluation).

```json
// Request
{
  "name": "Spot-check conversation",
  "response_ids": ["resp_abc123", "resp_def456"],
  "evaluators": ["task_adherence", "violence", "coherence"],
  "model_deployment": "gpt-4.1-mini"
}

// Response
{
  "eval_id": "eval_xxx",
  "run_id": "evalrun_yyy",
  "status": "running",
  "poll_url": "/evaluate/status/evalrun_yyy"
}
```

#### `POST /evaluate/agent-target`

Send test queries to an agent and evaluate the generated responses.

```json
// Request
{
  "name": "Agent regression test",
  "agent_name": "agent-1774946608254",
  "agent_version": "1",           // optional, latest if omitted
  "queries": [
    {"query": "What are the refund policies?"},
    {"query": "What are animal cage sizes for pet transport?"},
    {"query": "Can a terminated QMICE portal be reactivated?"}
  ],
  "evaluators": ["task_adherence", "coherence", "groundedness", "relevance", "violence"],
  "model_deployment": "gpt-4.1-mini"
}

// Response
{
  "eval_id": "eval_xxx",
  "run_id": "evalrun_yyy",
  "status": "running"
}
```

#### `POST /evaluate/synthetic`

Generate synthetic test queries and evaluate agent responses.

```json
// Request
{
  "name": "Synthetic coverage test",
  "agent_name": "agent-1774946608254",
  "prompt": "Generate customer service questions about Qatar Airways policies including baggage, refunds, loyalty programs, and pet transport",
  "samples_count": 20,
  "evaluators": ["task_adherence", "coherence", "violence"],
  "model_deployment": "gpt-4.1-mini"
}
```

#### `GET /evaluate/status/{run_id}`

Poll evaluation run status and get results.

```json
// Response (completed)
{
  "run_id": "evalrun_xyz789",
  "eval_id": "eval_abc123",
  "status": "completed",
  "report_url": "https://ai.azure.com/...",
  "result_counts": {"total": 10, "passed": 8, "failed": 2, "errored": 0},
  "per_evaluator": [
    {"name": "coherence", "passed": 10, "failed": 0, "pass_rate": 1.0, "avg_score": 4.2},
    {"name": "task_adherence", "passed": 8, "failed": 2, "pass_rate": 0.8, "avg_score": 3.6},
    {"name": "violence", "passed": 10, "failed": 0, "pass_rate": 1.0, "avg_score": 0.0}
  ],
  "items": [
    {
      "query": "What are refund policies?",
      "response_text": "Qatar Airways refund policies...",
      "results": [
        {"evaluator": "coherence", "score": 4, "label": "pass", "reason": "..."},
        {"evaluator": "task_adherence", "score": 2, "label": "fail", "reason": "Agent did not cite sources as instructed"}
      ]
    }
  ]
}
```

#### `POST /continuous/configure`

Set up or modify continuous evaluation rules.

```json
// Request
{
  "agent_name": "agent-1774946608254",
  "evaluators": ["violence", "coherence", "task_adherence"],
  "model_deployment": "gpt-4.1-mini",
  "max_hourly_runs": 50,
  "enabled": true
}

// Response
{
  "rule_id": "eval-rule-xxx",
  "status": "created",
  "agent_name": "agent-1774946608254",
  "evaluators": ["violence", "coherence", "task_adherence"],
  "max_hourly_runs": 50
}
```

#### `GET /continuous/rules`

List all active continuous evaluation rules.

#### `POST /red-team/run`

Trigger a red teaming run.

```json
// Request
{
  "name": "Pre-deployment safety scan",
  "agent_name": "agent-1774946608254",
  "risk_categories": ["violence", "hate_unfairness", "self_harm", "protected_materials", "sensitive_data_leakage"],
  "attack_strategies": ["jailbreak", "base64", "crescendo", "indirect_jailbreak"],
  "max_turns": 5,
  "max_simulations": 50
}

// Response
{
  "eval_id": "eval_rt_xxx",
  "run_id": "evalrun_rt_yyy",
  "status": "running",
  "estimated_duration_minutes": 30
}
```

#### `GET /evaluators/list`

List all available evaluators with metadata.

```json
// Response
{
  "built_in": [
    {"name": "builtin.coherence", "category": "quality", "requires_model": true, "input_fields": ["query", "response"]},
    {"name": "builtin.groundedness", "category": "rag", "requires_model": true, "input_fields": ["query", "response", "context"]},
    {"name": "builtin.violence", "category": "safety", "requires_model": false, "input_fields": ["query", "response"]},
    {"name": "builtin.task_adherence", "category": "agent", "requires_model": true, "input_fields": ["query", "response (output_items)"]},
    {"name": "builtin.tool_call_accuracy", "category": "agent", "requires_model": true, "input_fields": ["query", "response (output_items)"]},
    // ... all 30+ evaluators
  ],
  "custom": [
    {"name": "custom.kb_citation", "category": "domain", "description": "Checks if agent cites KB sources"},
    {"name": "custom.mcp_accuracy", "category": "domain", "description": "Validates MCP tool call parameters"},
    {"name": "custom.qr_policy_style", "category": "domain", "description": "Checks QR contact center style guidelines"}
  ]
}
```

#### `GET /health`

```json
{"status": "healthy", "version": "1.0.0", "foundry_connected": true, "app_insights_connected": true}
```

---

## 4. Custom Evaluators (Domain-Specific)

### 4.1 KB Citation Evaluator

Checks if agent responses cite knowledge base sources when they should.

```python
# evaluators/kb_citation_eval.py
def evaluate_kb_citation(query: str, response: str, tool_calls: list) -> dict:
    """
    Checks:
    1. Did the agent call knowledge_base_retrieve?
    2. Does the response reference source documents?
    3. Are citations formatted correctly (e.g., [Source: ...])
    
    Scoring:
    - 5: Called KB, cited sources with doc names
    - 4: Called KB, mentioned sources generically
    - 3: Called KB, no citation in response
    - 2: Didn't call KB but should have (query is KB-relevant)
    - 1: Fabricated citations
    """
```

### 4.2 MCP Accuracy Evaluator

Validates that MCP tool calls use correct parameters and the agent interprets results correctly.

```python
# evaluators/mcp_accuracy_eval.py
def evaluate_mcp_accuracy(query: str, response: str, tool_calls: list) -> dict:
    """
    Checks:
    1. Did the agent select the correct MCP tool for the query?
    2. Were parameters valid (no empty strings for enums, correct date formats)?
    3. Did the agent correctly interpret the tool output in its response?
    4. Did the agent avoid hallucinating data not in the tool response?
    
    Uses a GPT judge to assess correctness.
    """
```

### 4.3 QR Policy Style Evaluator

Checks if agent follows Qatar Airways contact center response guidelines.

```python
# evaluators/qr_policy_eval.py
def evaluate_qr_style(query: str, response: str) -> dict:
    """
    Checks against system prompt requirements:
    1. Leads with the answer (not filler)
    2. Uses bold for key facts
    3. Under 3 short paragraphs (unless breakdown requested)
    4. Uses bullet points for lists
    5. Recommends escalation when KB has no answer
    """
```

---

## 5. Next.js App Changes (TypeScript Layer)

### 5.1 New API Routes

```
app/api/eval/
├── trigger/route.ts           # Proxy to eval service: POST /evaluate/*
├── status/[runId]/route.ts    # Proxy to eval service: GET /evaluate/status/*
├── results/route.ts           # Query historical eval results
├── history/route.ts           # List all eval runs with summary
├── continuous/route.ts        # Configure continuous eval rules
├── red-team/route.ts          # Trigger red team runs
└── response-log/route.ts      # Store/retrieve response_id + metadata log
```

### 5.2 New UI Pages (Admin Only)

```
app/evaluations/
├── page.tsx                   # Dashboard: overview charts, recent runs, health
├── run/page.tsx               # Trigger new eval: select agent, evaluators, data
├── results/[id]/page.tsx      # Drill-down: per-item scores, reasoning, failures
├── continuous/page.tsx         # Configure continuous eval rules per agent
├── red-team/page.tsx          # Red teaming: run, view ASR, attack breakdown
└── history/page.tsx           # Full eval run history with filters
```

### 5.3 Response Capture Enhancement

In `app/api/foundry/responses/route.ts`, after every successful response:

```typescript
// After getting response from Foundry
const responseId = data.id
const conversationId = body.conversationId

// Fire-and-forget: log response metadata for evaluation
fetch('/api/eval/response-log', {
  method: 'POST',
  body: JSON.stringify({
    response_id: responseId,
    conversation_id: conversationId,
    agent_name: body.agentName,
    user_query: body.input,
    response_text: extractTextFromOutput(data.output),
    tool_calls: extractToolCalls(data.output),
    timestamp: new Date().toISOString(),
    has_kb_retrieval: data.output?.some(o => o.type === 'function_call'),
    has_mcp_call: data.output?.some(o => o.type === 'mcp_call'),
    token_count: data.usage?.total_tokens,
  })
})
```

### 5.4 Real-Time Score Badges in Chat UI

In agent-builder chat, after each response renders, optionally show lightweight quality scores:

```tsx
{isAdmin && response.evalScores && (
  <div className="flex gap-1 mt-1">
    <EvalBadge label="Quality" score={response.evalScores.coherence} />
    <EvalBadge label="Grounded" score={response.evalScores.groundedness} />
    <EvalBadge label="Safe" score={response.evalScores.safety} />
  </div>
)}
```

---

## 6. OpenTelemetry Integration (Next.js App)

### 6.1 Packages to Install

```bash
npm install @opentelemetry/sdk-node @opentelemetry/api \
  @azure/monitor-opentelemetry-exporter \
  @opentelemetry/semantic-conventions \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-fetch
```

### 6.2 Instrumentation File

```typescript
// lib/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { AzureMonitorTraceExporter } from '@azure/monitor-opentelemetry-exporter'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'

const exporter = new AzureMonitorTraceExporter({
  connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
})

const sdk = new NodeSDK({
  traceExporter: exporter,
  instrumentations: [new HttpInstrumentation()],
  serviceName: 'foundry-iq-demo',
})

sdk.start()
```

### 6.3 Custom Spans for Agent Calls

```typescript
// In /api/foundry/responses/route.ts
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('foundry-iq-demo')

export async function POST(request: Request) {
  const span = tracer.startSpan('agent.response', {
    attributes: {
      'gen_ai.system': 'azure.ai.foundry',
      'gen_ai.request.model': agentName,
      'gen_ai.operation.name': 'responses.create',
    }
  })

  try {
    // ... existing response logic
    span.setAttribute('gen_ai.response.id', data.id)
    span.setAttribute('gen_ai.response.model', data.model)
    span.setAttribute('gen_ai.usage.total_tokens', data.usage?.total_tokens)
    span.setStatus({ code: 0 })
  } catch (err) {
    span.setStatus({ code: 2, message: err.message })
    throw err
  } finally {
    span.end()
  }
}
```

---

## 7. Infrastructure Setup

### 7.1 Application Insights

```bash
# Create App Insights in iqpoc RG (same as Foundry project)
az monitor app-insights component create \
  --app appi-foundry-iq \
  --location eastus2 \
  --resource-group iqpoc \
  --workspace-resource-id $(az monitor log-analytics workspace show --workspace-name log-onlgvc76rbuge -g rg-hiacoo-mcp-private --query id -o tsv)
```

Then connect to Foundry project via Portal: Agents → Traces → Connect.

### 7.2 Evaluation Container App

```bash
# Build and push Docker image
az acr build \
  --registry cronlgvc76rbuge \
  --image eval-service:v1 \
  --file eval-service/Dockerfile \
  eval-service/

# Deploy as Container App in existing environment
az containerapp create \
  --name ca-eval-service \
  --resource-group rg-hiacoo-mcp-private \
  --environment cae-onlgvc76rbuge \
  --image cronlgvc76rbuge.azurecr.io/eval-service:v1 \
  --target-port 8000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 3 \
  --cpu 1.0 \
  --memory 2.0 \
  --env-vars \
    FOUNDRY_PROJECT_ENDPOINT=https://aikb-foundry-q36gpyt3maa7w.services.ai.azure.com/api/projects/proj-iqpoc \
    APPLICATIONINSIGHTS_CONNECTION_STRING=<from-appi-resource> \
    AZURE_CLIENT_ID=<user-assigned-MI> \
  --user-assigned <MI-resource-id>
```

### 7.3 RBAC Assignments

| Principal | Resource | Role | Purpose |
|---|---|---|---|
| Eval Container App MI | Foundry Project | `Azure AI User` | Create/run evaluations, manage continuous eval rules |
| Eval Container App MI | AI Services account | `Cognitive Services User` | Call AI-assisted evaluators (GPT judge) |
| Eval Container App MI | Application Insights | `Monitoring Contributor` | Write traces and eval results |
| Eval Container App MI | Application Insights | `Log Analytics Reader` | Query existing traces |

---

## 8. Evaluation Dashboard UI Design

### 8.1 Overview Page (`/evaluations`)

```
┌──────────────────────────────────────────────────────────────────┐
│  EVALUATION DASHBOARD                               [Time Range ▼]│
├──────────────┬──────────────┬──────────────┬─────────────────────┤
│ Overall Pass │ Avg Quality  │ Safety Score │ Active Cont. Rules  │
│   87.3%      │   4.1/5      │   99.2%      │      3              │
│  ▲ 2.1%      │  ▲ 0.3       │  ── stable   │                     │
├──────────────┴──────────────┴──────────────┴─────────────────────┤
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │    Quality Score Trend (7 days)                              │  │
│  │    ████████████████████████████████████                      │  │
│  │    Coherence ── Groundedness ── Task Adherence               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌───────────────────────┐  ┌───────────────────────────────────┐ │
│  │ Recent Eval Runs       │  │ Evaluator Pass Rates              │ │
│  │                        │  │                                    │ │
│  │ • Weekly QA  ✅ 92%    │  │ Coherence        ████████░ 95%   │ │
│  │ • Red Team   ⚠️ ASR 8% │  │ Groundedness     ███████░░ 88%   │ │
│  │ • Regression ✅ 100%   │  │ Task Adherence   ██████░░░ 82%   │ │
│  │ • Safety     ✅ 99%    │  │ Tool Accuracy    ████████░ 91%   │ │
│  │                        │  │ Violence         █████████ 100%  │ │
│  └───────────────────────┘  └───────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 Run Trigger Page (`/evaluations/run`)

- Select agent from dropdown
- Check evaluators (grouped by category: Quality, RAG, Agent, Safety, Custom)
- Choose data source: Stored responses (date range) | Upload JSONL | Synthetic generation
- Configure: model deployment for judges, thresholds
- "Run Evaluation" button → redirects to results page

### 8.3 Results Drill-Down (`/evaluations/results/[id]`)

- Summary cards (pass rate, avg scores per evaluator)
- Table: each row = one query-response pair with all evaluator scores
- Click row → expand to see full response text, tool calls, evaluator reasoning
- Export as CSV/JSONL
- Link to Foundry portal report

### 8.4 Continuous Eval Page (`/evaluations/continuous`)

- Per-agent rule cards showing: evaluators, sample rate, max hourly runs
- Toggle enable/disable
- Score trend charts from continuous eval results
- Alert configuration: threshold → notification

### 8.5 Red Team Page (`/evaluations/red-team`)

- Attack Success Rate (ASR) gauge chart
- Breakdown by risk category (bar chart)
- Breakdown by attack strategy (heatmap)
- Table of successful attacks with redacted prompts
- "Run Red Team Scan" button with config dialog

---

## 9. Data Flow — End-to-End for Every Conversation Turn

```
1. User sends message in chat UI
         │
2. Next.js /api/foundry/responses calls Foundry Responses API
         │
3. Response received (response_id, output, tool_calls)
         │
    ┌─────┴──────────────────────────────────────────────┐
    │                                                      │
    ▼                                                      ▼
4a. Return response to UI              4b. Fire-and-forget: log to
    (immediate)                             response store
                                                │
                                           ┌────┴────┐
                                           │         │
                                           ▼         ▼
                                     5a. Cosmos   5b. OpenTelemetry
                                     DB log       span → App Insights
                                           │
                                           │
6. Continuous Eval Rule triggers (async, Foundry-native)
         │
7. Evaluator scores stored in App Insights
         │
8. Dashboard reads scores and displays trends
```

---

## 10. Implementation Timeline (Detailed)

### Phase 1: Foundation (Days 1-3)

| Task | Details | Output |
|---|---|---|
| Create Application Insights | `az monitor app-insights component create` in `iqpoc` RG | `appi-foundry-iq` resource |
| Connect App Insights to Foundry | Via Foundry portal → Agents → Traces → Connect | Server-side traces auto-enabled |
| Add OpenTelemetry to Next.js | Install packages, create `lib/telemetry.ts`, emit spans in responses route | Client-side traces in App Insights |
| Build response capture store | New API route `/api/eval/response-log`, store in Cosmos DB (reuse `cosmos-onlgvc76rbuge` or new collection in existing) | Response log for offline eval |
| Scaffold eval service | FastAPI project, Dockerfile, `/health` endpoint | Container App deployed |
| Deploy to Container Apps Env | Build image → ACR → Container App in `cae-onlgvc76rbuge` | `ca-eval-service` running |

### Phase 2: Core Evaluation (Days 4-7)

| Task | Details | Output |
|---|---|---|
| Implement `/evaluate/batch` | Dataset eval using Foundry Evals API | Batch eval on stored data |
| Implement `/evaluate/by-response-ids` | Agent response eval using `azure_ai_responses` | Eval by response ID |
| Implement `/evaluate/agent-target` | Agent target eval: send queries, eval responses | Regression testing |
| Implement `/evaluate/single` | Synchronous single-response eval | Near-real-time scoring |
| Implement `/evaluate/status` | Poll eval run status, retrieve results | Status + results API |
| Build `/evaluations` dashboard page | Overview cards, charts (placeholder data initially) | Admin UI page |
| Build `/evaluations/run` trigger page | Form UI for selecting agent, evaluators, data source | Admin UI page |
| Build `/evaluations/results/[id]` page | Drill-down table with per-item scores | Admin UI page |
| Proxy API routes in Next.js | `/api/eval/*` routes that forward to eval service | TypeScript proxy layer |

### Phase 3: Continuous Evaluation + Monitoring (Days 8-10)

| Task | Details | Output |
|---|---|---|
| Implement `/continuous/configure` | Create/update Foundry Evaluation Rules via SDK | Continuous eval API |
| Implement `/continuous/rules` | List/delete continuous eval rules | Rule management |
| Build `/evaluations/continuous` page | Per-agent rule cards, score trends | Admin UI page |
| Wire dashboard to real data | Query App Insights for eval scores, display in charts | Live dashboard |
| Add real-time score badges | Lightweight grading on each chat response (optional toggle) | In-chat quality indicators |

### Phase 4: Red Teaming + Custom Evaluators (Days 11-14)

| Task | Details | Output |
|---|---|---|
| Implement `/red-team/run` | Red team eval using `azure_ai_red_team` data source | Red teaming API |
| Build `/evaluations/red-team` page | ASR gauge, attack breakdown, result table | Admin UI page |
| Build KB citation evaluator | Custom evaluator: checks KB source citing | Custom eval |
| Build MCP accuracy evaluator | Custom evaluator: validates MCP tool parameters | Custom eval |
| Build QR policy style evaluator | Custom evaluator: checks QR contact center guidelines | Custom eval |
| Implement `/evaluate/synthetic` | Synthetic data generation + eval | Synthetic testing |
| Add eval history page | `/evaluations/history` with full run history, filters | Admin UI page |
| Configure alerts | App Insights alerts for safety threshold breaches | Proactive monitoring |

---

## 11. Environment Variables

### Eval Service (Container App)

```env
# Foundry
FOUNDRY_PROJECT_ENDPOINT=https://aikb-foundry-q36gpyt3maa7w.services.ai.azure.com/api/projects/proj-iqpoc
FOUNDRY_MODEL_DEPLOYMENT=gpt-4.1-mini

# App Insights
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...

# Auth (Managed Identity)
AZURE_CLIENT_ID=<user-assigned-MI-client-id>  # optional, for user-assigned MI

# Service config
PORT=8000
LOG_LEVEL=info
CORS_ORIGINS=https://ambitious-smoke-063e2190f.1.azurestaticapps.net,http://localhost:3000
```

### Next.js App (additions to .env.local)

```env
# Evaluation service
EVAL_SERVICE_URL=https://ca-eval-service.<cae-domain>.swedencentral.azurecontainerapps.io

# Application Insights (for OTel)
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...
```

---

## 12. Security Considerations

1. **Eval service authentication:** Use Managed Identity for Foundry SDK calls. For HTTP calls from Next.js to the eval service, use an API key in a custom header or restrict ingress to the Container Apps Environment's internal network.

2. **Content recording:** OFF in production (`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`). Only enable during debugging.

3. **Red team data:** Results are redacted by Foundry. Adversarial prompts are not stored in conversation history (transient runs).

4. **RBAC:** Eval endpoints are admin-only in our UI (password-protected). The eval service itself requires `Azure AI User` on the Foundry project.

5. **Data retention:** Eval results in App Insights follow the workspace's retention policy (default 90 days). For longer retention, configure archive in Log Analytics.
