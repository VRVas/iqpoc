# Foundry IQ Demo — Architecture & Data Flow

> **Last Updated:** 2025-04-11
> **Project:** Qatar Airways Contact Center Operator Companion

---

## 1. High-Level Architecture

The first diagram shows all Azure resources across both resource groups, their relationships, and primary communication protocols:

- **Next.js 14** runs on Azure Static Web App, serves as both frontend and API gateway
- **Foundry Agent Service** orchestrates agent conversations, calling tools via MCP connections
- **Two MCP tool sources**: KB MCP (Azure AI Search native) and Airport Ops MCP (custom Container App in Sweden Central)
- **Eval infrastructure** is a separate FastAPI Container App with its own Managed Identity, Cosmos DB, and observability stack

```mermaid
graph TB
    subgraph Users["👤 Users"]
        Browser["Web Browser"]
    end

    subgraph SWA["Azure Static Web App<br/><i>East US 2</i><br/>"]
        NextJS["Next.js 14 App<br/>(App Router + API Routes)"]
    end

    subgraph Foundry["Azure AI Foundry<br/><i>East US 2</i><br/>"]
        AgentSvc["Agent Service v2<br/>(Responses API)"]
        Models["Model Deployments<br/>Azure OpenAI"]
        Embeddings["Embedding Models<br/>text-embedding-3-small<br/>text-embedding-3-large"]
        EvalAPI["Evaluation API"]
        Connections["Project Connections<br/>openai · search · kb-mcp-*"]
    end

    subgraph Search["Azure AI Search<br/><i>East US 2</i><br/>"]
        KBs["Knowledge Bases<br/>(Foundry IQ)"]
        McpEndpoint["MCP Endpoint<br/>/knowledgebases/{kb}/mcp"]
        Indexes["Search Indexes"]
    end

    subgraph Storage["Azure Storage<br/><i>East US 2</i><br/>"]
        BlobDocs["Blob: sample-documents<br/>(KB source documents)"]
    end

    subgraph EvalInfra["Evaluation Infrastructure<br/>East US 2"]
        EvalCA["Container App<br/><i>Python FastAPI</i><br/>"]
        EvalMI["Managed Identity<br/><i>id-eval-service</i>"]
        CosmosDB["Cosmos DB Serverless<br/><i>Response logs + eval results</i><br/>"]
        LogAnalytics["Log Analytics"]
        AppInsights["App Insights"]
    end

    subgraph MCP_Infra["Airport Ops MCP<br/><i>Sweden Central</i><br/>"]
        AirportMCP["Container App<br/><i>~40 tools</i><br/>"]
        ACR["Container Registry<br/>"]
        VNet["VNet + Private Endpoints"]
    end

    Browser -->|HTTPS| NextJS
    NextJS -->|"API Key"| Search
    NextJS -->|"Bearer Token<br/>(Service Principal)"| Foundry
    NextJS -->|"API Key"| Models

    AgentSvc --> Connections
    Connections -->|"RemoteTool<br/>ProjectManagedIdentity"| McpEndpoint
    Connections -->|"RemoteTool<br/>OpenAPI"| AirportMCP
    AgentSvc --> Models

    KBs --> Indexes
    Indexes -->|"Indexer"| BlobDocs
    KBs --> Embeddings

    EvalCA -->|"Managed Identity"| EvalAPI
    EvalCA --> CosmosDB
    EvalCA --> AppInsights
    AppInsights --> LogAnalytics
    EvalMI -.->|"auth"| EvalCA

    ACR -.->|"images"| EvalCA
    ACR -.->|"images"| AirportMCP

    classDef azure fill:#0078d4,color:#fff,stroke:#005a9e
    classDef foundry fill:#6B3FA0,color:#fff,stroke:#4B2D73
    classDef search fill:#008272,color:#fff,stroke:#005C50
    classDef storage fill:#0063B1,color:#fff,stroke:#004578
    classDef eval fill:#E3008C,color:#fff,stroke:#A4006A
    classDef mcp fill:#FF8C00,color:#fff,stroke:#CC7000
    classDef user fill:#333,color:#fff,stroke:#111

    class NextJS azure
    class AgentSvc,Models,Embeddings,EvalAPI,Connections foundry
    class KBs,McpEndpoint,Indexes search
    class BlobDocs storage
    class EvalCA,EvalMI,CosmosDB,LogAnalytics,AppInsights eval
    class AirportMCP,ACR,VNet mcp
    class Browser user
```

---

## 2. Agent Chat Data Flow

Shows the step-by-step request lifecycle when a user sends a message through the Agent Builder:

1. Browser → Next.js API route → Foundry Responses API
2. Foundry orchestrates: LLM decides which tools to call → MCP KB retrieval (via `ProjectManagedIdentity`) and/or Airport Ops MCP
3. Results stream back as SSE events, parsed by `parseMcpKbSources()` into structured sources + retrieval metadata

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser
    participant SWA as Next.js API Routes<br/>(Static Web App)
    participant F as Foundry Agent Service<br/>(Responses API)
    participant MCP_KB as KB MCP Endpoint<br/>(AI Search)
    participant MCP_OPS as Airport Ops MCP<br/>(Container App)
    participant LLM as GPT-4.1 / GPT-5

    U->>SWA: POST /api/foundry/responses<br/>{agentId, message, previous_response_id}
    SWA->>F: POST /responses<br/>{model, instructions, tools[], input}
    
    Note over F: Agent orchestration begins
    F->>LLM: Prompt + tool definitions
    LLM-->>F: tool_call: KB retrieve
    
    F->>MCP_KB: MCP call via RemoteTool<br/>(ProjectManagedIdentity auth)
    MCP_KB-->>F: Search results + citations<br/>(【N:M†source】 format)
    
    opt Airport Ops query detected
        F->>MCP_OPS: MCP call via RemoteTool<br/>(OpenAPI spec)
        MCP_OPS-->>F: Flight/gate/baggage data
    end
    
    F->>LLM: Retrieved context + tool outputs
    LLM-->>F: Final response with citations
    
    F-->>SWA: Streaming response events<br/>(SSE: response.output_item.*)
    
    Note over SWA: parseMcpKbSources()<br/>Extract sources, build metadata
    SWA-->>U: Streamed response +<br/>_mcpSources + _mcpRetrievalMeta
```

---

## 3. KB Playground Data Flow

The direct query path (no Foundry agent involved):

1. Browser → Next.js → Azure AI Search `retrieve` API (direct REST)
2. Search results passed as context to standalone Azure OpenAI
3. Completions streamed with `[ref_id:N]` citation format

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser
    participant SWA as Next.js API Routes
    participant Search as Azure AI Search
    participant AOAI as Azure OpenAI<br/>(Standalone)

    U->>SWA: POST /api/knowledge-bases/{id}/retrieve<br/>{query, knowledgeBaseId, runtimeSettings}
    
    SWA->>Search: POST /knowledgebases/{kb}/retrieve<br/>api-version=2025-11-01-preview<br/>{search, vectorQueries, queryType, top}
    Search-->>SWA: {value: [{content, title, url, score}...]}
    
    Note over SWA: Build context from search results
    
    SWA->>AOAI: POST /chat/completions<br/>{model, messages[system+context+user]}
    AOAI-->>SWA: Streaming completion with [ref_id:N] citations
    
    SWA-->>U: Streamed answer +<br/>_rawRetrieval sources +<br/>retrievalStats
```

---

## 4. Evaluation Pipeline

Three evaluation modes all flow through the eval service:

| Mode | Data Source | Agent Execution |
|------|------------|-----------------|
| **Agent-Target** | Foundry-generated queries | Agent runs live with MCP tools |
| **Synthetic** | AI-generated questions | Agent runs live with MCP tools |
| **Dataset** | Pre-collected Q&A pairs | No agent execution (scoring only) |

All modes auto-inject `tool_definitions` from the agent definition for tool-call evaluators.

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser<br/>/evaluations/run
    participant SWA as Next.js API<br/>/api/foundry/evaluations
    participant ES as Eval Service<br/>(Container App v20)
    participant FE as Foundry Eval API
    participant FA as Foundry Agent Service
    participant MCP as MCP Tools<br/>(KB + Airport Ops)
    participant Cosmos as Cosmos DB

    U->>SWA: POST /api/foundry/evaluations<br/>{agentId, mode, evaluators[], tool_definitions}
    SWA->>ES: POST /evaluate<br/>{agent_id, mode, evaluators, tool_definitions}
    
    alt Agent-Target Mode
        ES->>FE: Create eval with agent_target<br/>{testing_criteria, tool_definitions in data_mapping}
        FE->>FA: Run agent conversation (N queries)
        FA->>MCP: Tool calls (auto-executed)
        MCP-->>FA: Results
        FA-->>FE: Agent responses
        FE->>FE: Score with selected evaluators<br/>(26 available)
    else Synthetic Mode
        ES->>FE: Create eval with synthetic data<br/>{num_queries, tool_definitions}
        FE->>FE: Generate synthetic questions
        FE->>FA: Run agent on synthetic data
        FA->>MCP: Tool calls
        MCP-->>FA: Results
        FA-->>FE: Responses
        FE->>FE: Score responses
    else Dataset Mode
        Note over ES: Read dataset items<br/>Inject tool_definitions per item
        ES->>FE: Create eval with dataset<br/>{data[], evaluators}
        FE->>FE: Score pre-collected data
    end
    
    FE-->>ES: Eval results {scores, per_item}
    ES->>Cosmos: Store results
    ES-->>SWA: {eval_id, status, scores}
    SWA-->>U: Display results + per-item breakdown
```

---

## 5. Authentication & RBAC

| Identity | Authenticates To | Method |
|----------|-----------------|--------|
| Service Principal | Foundry (Agents + Evals) | Bearer token (auto-refresh) |
| Project MI (`cefe0022...`) | AI Search (MCP calls) | Search Index Data Reader + Contributor |
| Eval MI (`id-eval-service`) | Foundry Eval API | Cognitive Services User |
| API Keys | Search + OpenAI | `api-key` header |

```mermaid
graph LR
    subgraph Auth["Authentication Methods"]
        SP["Service Principal<br/><i>vercel-ai-agent-demo</i><br/>Bearer Token (auto-refresh)"]
        MI_Proj["Project Managed Identity<br/><i>cefe0022-0fcb-4dc4-ab88-fba6cb60c7b8</i>"]
        MI_Eval["Eval Managed Identity<br/><i>id-eval-service</i><br/>2cf9ca2a-8c77-448e-9e86-c53c3273900f"]
        APIKey["API Keys<br/>(Search Admin + OpenAI)"]
    end

    subgraph RBAC["Role Assignments"]
        R1["Cognitive Services User"]
        R2["Search Index Data Reader"]
        R3["Search Service Contributor"]
        R4["Cognitive Services User"]
    end

    subgraph Targets["Target Resources"]
        Foundry["Foundry<br/>(Agents + Evals)"]
        Search["AI Search<br/>(KB + MCP)"]
        AOAI["Azure OpenAI<br/>(Completions)"]
    end

    SP -->|"bearer token"| Foundry
    APIKey -->|"api-key header"| Search
    APIKey -->|"api-key header"| AOAI

    MI_Proj --> R2 --> Search
    MI_Proj --> R3 --> Search
    SP --> R1 --> Foundry
    MI_Eval --> R4 --> Foundry

    classDef auth fill:#0078d4,color:#fff
    classDef rbac fill:#107C10,color:#fff
    classDef target fill:#6B3FA0,color:#fff

    class SP,MI_Proj,MI_Eval,APIKey auth
    class R1,R2,R3,R4 rbac
    class Foundry,Search,AOAI target
```

---

## 6. Application Route Map

```mermaid
graph TB
    subgraph Pages["Frontend Routes"]
        LP["/ Landing Page"]
        Test["/test ⭐<br/>Direct KB Queries"]
        PG["/playground<br/>KB Playground"]
        PGA["/playground/[agentId]"]
        Agents["/agents<br/>Foundry Agents"]
        AB["/agent-builder<br/>Agent Builder + Chat"]
        KB["/knowledge<br/>KB Management"]
        KBC["/knowledge/create"]
        KBE["/knowledge/[id]"]
        KBL["/knowledge-bases<br/>KB List"]
        KBS["/knowledge-sources"]
    end

    subgraph APIs["API Routes (Server-Side)"]
        direction TB
        A1["/api/knowledge-bases/*<br/>KB CRUD + Retrieve"]
        A2["/api/knowledge-sources/*<br/>Source Management"]
        A3["/api/index-stats<br/>Search Index Stats"]
        A4["/api/agents/*<br/>Foundry Agent CRUD"]
        A5["/api/agentsv2/* 🚧<br/>V2 Placeholder"]
    end

    subgraph External["External API Routes<br/>(in eval-service app)"]
        E1["POST /evaluate<br/>Run evaluation"]
        E2["GET /evaluate/{id}<br/>Check status"]
        E3["GET /health<br/>Health check"]
    end

    LP --> Test
    LP --> PG
    LP --> Agents
    LP --> KB
    
    Test --> A1
    PG --> A1
    AB --> A4
    KB --> A1
    KB --> A2
    KBL --> A1
    KBS --> A2

    classDef page fill:#0078d4,color:#fff
    classDef api fill:#107C10,color:#fff
    classDef ext fill:#E3008C,color:#fff

    class LP,Test,PG,PGA,Agents,AB,KB,KBC,KBE,KBL,KBS page
    class A1,A2,A3,A4,A5 api
    class E1,E2,E3 ext
```

---

## 7. Resource Inventory

### `iqpoc` Resource Group (East US 2) — 14 resources

| Resource | Type | Purpose |
|----------|------|---------|
| `aikb-web-q36gpyt3maa7w` | Static Web App | Next.js frontend + API routes |
| `aikb-foundry-q36gpyt3maa7w` | CognitiveServices | AI Services (8 model deployments) |
| `aikb-search-q36gpyt3maa7w` | AI Search (Basic) | Knowledge Bases, MCP endpoints, indexes |
| `aikbstorageq36gpyt3maa7w` | Storage | KB source documents (blob) |
| `aikb-hub-q36gpyt3maa7w` | ML Hub | Foundry hub workspace |
| `aikb-project-q36gpyt3maa7w` | ML Project | Foundry project workspace |
| `ca-eval-service` | Container App | Python FastAPI eval service (v20) |
| `cae-eval-iqpoc` | Container Apps Env | Hosts eval service |
| `id-eval-service` | Managed Identity | Eval service auth |
| `cosmos-eval-iqpoc` | Cosmos DB (Serverless) | Response logs + eval results |
| `log-eval-iqpoc` | Log Analytics | Eval service logging |
| `appi-eval-iqpoc` | Application Insights | Eval telemetry |

### `rg-hiacoo-mcp-private` (Sweden Central) — Cross-RG resources used

| Resource | Type | Purpose |
|----------|------|---------|
| `cronlgvc76rbuge` | ACR | Container images (eval-service + airport-ops) |
| `ca-pizza-mcp-onlgvc76rbuge` | Container App | Airport Ops MCP server (~40 tools) |
| `vnet-mcp-onlgvc76rbuge` | VNet | Private networking for MCP infra |

### Foundry Project Connections

| Connection | Type | Target |
|-----------|------|--------|
| `openai-connection` | AzureOpenAI | `aikb-openai-q36gpyt3maa7w` |
| `search-connection` | CognitiveSearch | `aikb-search-q36gpyt3maa7w` |
| `kb-mcp-test41mini` | RemoteTool | KB MCP endpoint (auto-created per KB) |

### Model Deployments

| Model | Deployment Name | Purpose |
|-------|----------------|---------|
| `gpt-4.1` | gpt-4.1 | Primary agent model |
| `gpt-4.1-mini` | gpt-4.1-mini | Fast/cheap agent model |
| `gpt-5` | gpt-5 | Advanced reasoning |
| `gpt-5.2` | gpt-5.2 | Latest reasoning |
| `gpt-5.4-mini` | gpt-5.4-mini | Efficient reasoning |
| `gpt-4o-mini` | gpt-4o-mini | Legacy / fallback |
| `text-embedding-3-small` | text-embedding-3-small | KB vectorization |
| `text-embedding-3-large` | text-embedding-3-large | High-dim KB vectorization |

---

## 8. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `AZURE_SEARCH_ENDPOINT` | Yes | AI Search service URL |
| `AZURE_SEARCH_API_KEY` | Yes | AI Search admin/query key |
| `AZURE_SEARCH_API_VERSION` | Yes | Search API version (`2025-11-01-preview`) |
| `NEXT_PUBLIC_AZURE_OPENAI_ENDPOINT` | Yes | Azure OpenAI endpoint (Foundry AI Services) |
| `AZURE_OPENAI_API_KEY` | Yes | Azure OpenAI key |
| `NEXT_PUBLIC_STANDALONE_AOAI_ENDPOINT` | Yes | Standalone OpenAI endpoint (higher rate limits) |
| `NEXT_PUBLIC_STANDALONE_AOAI_KEY` | Yes | Standalone OpenAI key |
| `FOUNDRY_PROJECT_ENDPOINT` | Yes | Foundry project endpoint URL |
| `FOUNDRY_CS_PROJECT_ARM_ID` | Yes | CognitiveServices project ARM ID (for MCP connections) |
| `AZURE_AUTH_METHOD` | Yes | `service-principal` / `managed-identity` |
| `AZURE_TENANT_ID` | SP | Service principal tenant |
| `AZURE_CLIENT_ID` | SP | Service principal app ID |
| `AZURE_CLIENT_SECRET` | SP | Service principal password |
| `NEXT_PUBLIC_SEARCH_ENDPOINT` | Yes | Public search endpoint (for MCP URLs) |

---

**END OF DOCUMENT**
