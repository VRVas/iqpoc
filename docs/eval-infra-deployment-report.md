# Evaluation Platform — Infrastructure Deployment Report

> **Date:** April 5, 2026  
> **Subscription:** `ME-MngEnvMCAP650012-vvasilescu-1` (`e7f1696a-37dd-4876-accb-2facb8713917`)  
> **Resource Group:** `iqpoc`  
> **Region:** East US 2

---

## Resources Created

### 1. Log Analytics Workspace

| Property | Value |
|---|---|
| **Name** | `log-eval-iqpoc` |
| **Resource Group** | `iqpoc` |
| **Location** | `eastus2` |
| **SKU** | `PerGB2018` |
| **Retention** | 90 days |
| **Customer ID** | `950e0d18-366c-4587-b392-3d9e374d8ded` |

**Created with:**
```bash
az monitor log-analytics workspace create \
  --workspace-name log-eval-iqpoc \
  --resource-group iqpoc \
  --location eastus2 \
  --sku PerGB2018 \
  --retention-time 90
```

---

### 2. Application Insights

| Property | Value |
|---|---|
| **Name** | `appi-eval-iqpoc` |
| **Resource Group** | `iqpoc` |
| **Location** | `eastus2` |
| **Kind** | `web` |
| **Workspace** | `log-eval-iqpoc` |
| **Instrumentation Key** | `5ad0f42c-ce03-40aa-ba8a-c4ad93e1debd` |
| **Connection String** | `InstrumentationKey=5ad0f42c-ce03-40aa-ba8a-c4ad93e1debd;IngestionEndpoint=https://eastus2-3.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus2.livediagnostics.monitor.azure.com/;ApplicationId=d39b0a7b-55ce-468f-973a-a74cb9755944` |

**Created with:**
```bash
az monitor app-insights component create \
  --app appi-eval-iqpoc \
  -g iqpoc \
  --location eastus2 \
  --workspace "/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/iqpoc/providers/Microsoft.OperationalInsights/workspaces/log-eval-iqpoc" \
  --kind web
```

**TODO:** Connect this Application Insights resource to the Foundry project (`proj-iqpoc`) via the Foundry portal: **Agents → Traces → Connect → Select `appi-eval-iqpoc`**.

---

### 3. Cosmos DB Account (Serverless)

| Property | Value |
|---|---|
| **Name** | `cosmos-eval-iqpoc` |
| **Resource Group** | `iqpoc` |
| **Location** | `eastus2` |
| **API** | NoSQL (SQL) |
| **Capacity Mode** | Serverless |
| **Endpoint** | `https://cosmos-eval-iqpoc.documents.azure.com:443/` |
| **Consistency** | Session |
| **Database** | `eval-db` |
| **Containers** | `response-log` (partition: `/agentName`), `eval-results` (partition: `/evalId`) |

**Created with:**
```bash
# Account
az cosmosdb create --name cosmos-eval-iqpoc -g iqpoc \
  --locations regionName=eastus2 \
  --capabilities EnableServerless \
  --kind GlobalDocumentDB \
  --default-consistency-level Session

# Database
az cosmosdb sql database create \
  --account-name cosmos-eval-iqpoc -g iqpoc \
  --name eval-db

# Containers
az cosmosdb sql container create \
  --account-name cosmos-eval-iqpoc -g iqpoc \
  --database-name eval-db \
  --name response-log \
  --partition-key-path /agentName

az cosmosdb sql container create \
  --account-name cosmos-eval-iqpoc -g iqpoc \
  --database-name eval-db \
  --name eval-results \
  --partition-key-path /evalId
```

---

### 4. Container Apps Environment

| Property | Value |
|---|---|
| **Name** | `cae-eval-iqpoc` |
| **Resource Group** | `iqpoc` |
| **Location** | `eastus2` |
| **Domain** | `proudplant-b551a736.eastus2.azurecontainerapps.io` |
| **Log Analytics** | `log-eval-iqpoc` |

**Created with:**
```bash
LAW_CLIENT_ID=$(az monitor log-analytics workspace show \
  --workspace-name log-eval-iqpoc -g iqpoc --query customerId -o tsv)
LAW_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --workspace-name log-eval-iqpoc -g iqpoc --query primarySharedKey -o tsv)

az containerapp env create \
  --name cae-eval-iqpoc -g iqpoc \
  --location eastus2 \
  --logs-workspace-id $LAW_CLIENT_ID \
  --logs-workspace-key "$LAW_KEY"
```

---

### 5. User-Assigned Managed Identity

| Property | Value |
|---|---|
| **Name** | `id-eval-service` |
| **Resource Group** | `iqpoc` |
| **Location** | `eastus2` |
| **Client ID** | `2cf9ca2a-8c77-448e-9e86-c53c3273900f` |
| **Principal ID** | `61f6af66-e576-449d-befd-784f98a7eb67` |

**Created with:**
```bash
az identity create --name id-eval-service -g iqpoc --location eastus2
```

---

### 6. RBAC Role Assignments

All assigned to principal `61f6af66-e576-449d-befd-784f98a7eb67` (`id-eval-service`):

| Role | Scope | Purpose |
|---|---|---|
| `Azure AI User` | `aikb-foundry-q36gpyt3maa7w` (AI Services) | Create/run evaluations via Foundry SDK |
| `Cognitive Services User` | `aikb-foundry-q36gpyt3maa7w` (AI Services) | Call GPT models for AI-assisted evaluators |
| `Monitoring Contributor` | `appi-eval-iqpoc` (App Insights) | Write traces and eval metrics |
| `Log Analytics Reader` | `log-eval-iqpoc` (Log Analytics) | Query existing traces |
| `Cosmos DB Built-in Data Contributor` | `cosmos-eval-iqpoc` (Cosmos DB) | Read/write response logs and eval results |
| `AcrPull` | `cronlgvc76rbuge` (Container Registry) | Pull container images for deployment |

**Created with:**
```bash
EVAL_MI_PRINCIPAL=$(az identity show --name id-eval-service -g iqpoc --query principalId -o tsv)
AI_SERVICES_ID=$(az cognitiveservices account show --name aikb-foundry-q36gpyt3maa7w -g iqpoc --query id -o tsv)
APPI_ID=$(az monitor app-insights component show --app appi-eval-iqpoc -g iqpoc --query id -o tsv)
LAW_ID=$(az monitor log-analytics workspace show --workspace-name log-eval-iqpoc -g iqpoc --query id -o tsv)
ACR_ID=$(az acr show --name cronlgvc76rbuge -g rg-hiacoo-mcp-private --query id -o tsv)

az role assignment create --assignee $EVAL_MI_PRINCIPAL --role "Azure AI User" --scope $AI_SERVICES_ID
az role assignment create --assignee $EVAL_MI_PRINCIPAL --role "Cognitive Services User" --scope $AI_SERVICES_ID
az role assignment create --assignee $EVAL_MI_PRINCIPAL --role "Monitoring Contributor" --scope $APPI_ID
az role assignment create --assignee $EVAL_MI_PRINCIPAL --role "Log Analytics Reader" --scope $LAW_ID
az role assignment create --assignee $EVAL_MI_PRINCIPAL --role "AcrPull" --scope $ACR_ID

# Cosmos DB data-plane role (built-in contributor)
az cosmosdb sql role assignment create \
  --account-name cosmos-eval-iqpoc -g iqpoc \
  --scope "/" \
  --principal-id $EVAL_MI_PRINCIPAL \
  --role-definition-id "00000000-0000-0000-0000-000000000002"
```

---

### 7. Eval Service Container App

| Property | Value |
|---|---|
| **Name** | `ca-eval-service` |
| **Resource Group** | `iqpoc` |
| **Environment** | `cae-eval-iqpoc` |
| **Image** | `cronlgvc76rbuge.azurecr.io/eval-service/eval-service:v1` |
| **FQDN** | `ca-eval-service.proudplant-b551a736.eastus2.azurecontainerapps.io` |
| **Health Endpoint** | `https://ca-eval-service.proudplant-b551a736.eastus2.azurecontainerapps.io/health` |
| **CPU** | 1.0 vCPU |
| **Memory** | 2.0 Gi |
| **Min Replicas** | 0 (scale-to-zero) |
| **Max Replicas** | 3 |
| **Ingress** | External (HTTPS) |
| **Port** | 8000 |
| **Identity** | `id-eval-service` (user-assigned) |

**Environment Variables:**

| Variable | Value |
|---|---|
| `FOUNDRY_PROJECT_ENDPOINT` | `https://aikb-foundry-q36gpyt3maa7w.services.ai.azure.com/api/projects/proj-iqpoc` |
| `FOUNDRY_MODEL_DEPLOYMENT` | `gpt-4.1-mini` |
| `COSMOS_ENDPOINT` | `https://cosmos-eval-iqpoc.documents.azure.com:443/` |
| `COSMOS_DATABASE` | `eval-db` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `InstrumentationKey=5ad0f42c-ce03-40aa-ba8a-c4ad93e1debd;...` |
| `AZURE_CLIENT_ID` | `2cf9ca2a-8c77-448e-9e86-c53c3273900f` |
| `CORS_ORIGINS` | `http://localhost:3000,https://ambitious-smoke-063e2190f.1.azurestaticapps.net` |
| `LOG_LEVEL` | `info` |

**Created with:**
```bash
# Build image
az acr build --registry cronlgvc76rbuge \
  --image eval-service/eval-service:v1 \
  --file eval-service/Dockerfile \
  eval-service/

# Deploy
az containerapp create \
  --name ca-eval-service \
  --resource-group iqpoc \
  --environment cae-eval-iqpoc \
  --image cronlgvc76rbuge.azurecr.io/eval-service/eval-service:v1 \
  --target-port 8000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 3 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --registry-server cronlgvc76rbuge.azurecr.io \
  --registry-identity $MI_ID \
  --user-assigned $MI_ID \
  --env-vars \
    FOUNDRY_PROJECT_ENDPOINT=... \
    FOUNDRY_MODEL_DEPLOYMENT=gpt-4.1-mini \
    COSMOS_ENDPOINT=... \
    COSMOS_DATABASE=eval-db \
    APPLICATIONINSIGHTS_CONNECTION_STRING=... \
    AZURE_CLIENT_ID=... \
    CORS_ORIGINS=... \
    LOG_LEVEL=info
```

---

## Update Commands (for redeployment)

```bash
# Rebuild and update image
az acr build --registry cronlgvc76rbuge \
  --image eval-service/eval-service:v2 \
  --file eval-service/Dockerfile \
  eval-service/

# Update Container App to new image
az containerapp update \
  --name ca-eval-service -g iqpoc \
  --image cronlgvc76rbuge.azurecr.io/eval-service/eval-service:v2
```

---

## Remaining Manual Steps

1. **Connect Application Insights to Foundry project** — Go to Foundry portal → `proj-iqpoc` → Agents → Traces → Connect → Select `appi-eval-iqpoc`. This enables server-side trace auto-collection.

2. **Add `EVAL_SERVICE_URL` to Next.js `.env.local`:**
   ```
   EVAL_SERVICE_URL=https://ca-eval-service.proudplant-b551a736.eastus2.azurecontainerapps.io
   ```

3. **Add `APPLICATIONINSIGHTS_CONNECTION_STRING` to Next.js `.env.local`** (for OpenTelemetry):
   ```
   APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=5ad0f42c-ce03-40aa-ba8a-c4ad93e1debd;IngestionEndpoint=https://eastus2-3.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus2.livediagnostics.monitor.azure.com/;ApplicationId=d39b0a7b-55ce-468f-973a-a74cb9755944
   ```
