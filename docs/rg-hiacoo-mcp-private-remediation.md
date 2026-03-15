# rg-hiacoo-mcp-private — Networking & Identity Remediation

> **Executed:** March 15, 2026  
> **Subscription:** `e7f1696a-37dd-4876-accb-2facb8713917`  
> **Resource Group:** `rg-hiacoo-mcp-private` (Sweden Central)  
> **Purpose:** Unblock the MCP tool chain: Foundry Agent → Container App (MCP Server) → Function App → Cosmos DB

---

## Problem Summary

Azure policies (Audit-only, not Deny) had flagged resources, and at some point `publicNetworkAccess` was disabled on both the Storage Account and Cosmos DB — with **no private endpoints or VNet rules** configured as alternatives. This made the Function App unable to start (no access to its own storage) and unable to reach Cosmos DB for flight data.

Additionally, the Function App's system-assigned managed identity had **zero RBAC roles** on its backing Storage Account, which is required for Flex Consumption plan operation.

---

## Architecture Chain

```
Foundry Agent Runtime
  → airport-ops-mcp connection (RemoteTool, authType: None)
    → Container App: ca-pizza-mcp-onlgvc76rbuge (MCP server, /mcp endpoint)
      → Function App: func-pizza-api-onlgvc76rbuge (flights-api)
        → Storage Account: stonlgvc76rbuge (deployment blobs, queues, tables)
        → Cosmos DB: cosmos-onlgvc76rbuge (flight operational data)
```

---

## Fix 1: Storage Account — Re-enable Public Network Access

**Resource:** `stonlgvc76rbuge`  
**Issue:** `publicNetworkAccess: Disabled`, no private endpoints, no VNet rules  
**Impact:** Function App couldn't access its own deployment storage → app wouldn't start

```bash
az storage account update \
  --name stonlgvc76rbuge \
  --resource-group rg-hiacoo-mcp-private \
  --public-network-access Enabled
```

**Result:** `publicNetworkAccess: "Enabled"`

---

## Fix 2: RBAC — Grant Function App MI Storage Roles

**Resource:** Storage Account `stonlgvc76rbuge`  
**Principal:** Function App system-assigned managed identity `e19913be-5137-4d1a-bbac-94c117c8e506`  
**Issue:** Zero roles assigned — Flex Consumption plan requires Blob, Queue, and Table access  

```bash
# Storage Blob Data Owner
az role assignment create \
  --assignee e19913be-5137-4d1a-bbac-94c117c8e506 \
  --role "Storage Blob Data Owner" \
  --scope /subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/rg-hiacoo-mcp-private/providers/Microsoft.Storage/storageAccounts/stonlgvc76rbuge

# Storage Queue Data Contributor
az role assignment create \
  --assignee e19913be-5137-4d1a-bbac-94c117c8e506 \
  --role "Storage Queue Data Contributor" \
  --scope /subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/rg-hiacoo-mcp-private/providers/Microsoft.Storage/storageAccounts/stonlgvc76rbuge

# Storage Table Data Contributor
az role assignment create \
  --assignee e19913be-5137-4d1a-bbac-94c117c8e506 \
  --role "Storage Table Data Contributor" \
  --scope /subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/rg-hiacoo-mcp-private/providers/Microsoft.Storage/storageAccounts/stonlgvc76rbuge
```

**Result:** All 3 roles verified via `az role assignment list`

---

## Fix 3: Cosmos DB — Re-enable Public Network Access

**Resource:** `cosmos-onlgvc76rbuge`  
**Issue:** `publicNetworkAccess: Disabled`, no private endpoints  
**Impact:** Function App couldn't reach Cosmos DB → flight data API returned errors

```bash
az cosmosdb update \
  --name cosmos-onlgvc76rbuge \
  --resource-group rg-hiacoo-mcp-private \
  --public-network-access ENABLED
```

**Result:** `publicNetworkAccess: "Enabled"`

---

## Fix 4: Function App Restart

After applying networking and RBAC fixes, the Function App needed a restart to pick up the changes.

```bash
az functionapp restart \
  --name func-pizza-api-onlgvc76rbuge \
  --resource-group rg-hiacoo-mcp-private
```

**Verification:**
```bash
curl -s -o /dev/null -w "HTTP_STATUS:%{http_code}" \
  "https://func-pizza-api-onlgvc76rbuge.azurewebsites.net/api/flights/search?date=2026-03-15"
# Result: HTTP_STATUS:200 (574,850 chars of flight JSON)
```

---

## Verification: E2E MCP Chain

After all fixes, the full chain was tested via the Foundry Responses API:

```
Conv: conv_ace20f72ff532a1c00OqAcRk2IXapNcEtelV6vHfoYtrpP6j07
Status: completed, Outputs: 3
  1. mcp_list_tools      → MCP tool discovery (Foundry enumerates tools from MCP server)
  2. mcp_call             → get_top_delays(limit=20, date=2026-03-15)
  3. message              → Flight delay table with real data from Cosmos DB
```

Agent used: `agent-1773561470728` with MCP tool definition:
```json
{
  "type": "mcp",
  "server_label": "airport_ops",
  "server_url": "https://ca-pizza-mcp-onlgvc76rbuge.jollymushroom-1f42138d.swedencentral.azurecontainerapps.io/mcp",
  "require_approval": "never",
  "project_connection_id": "airport-ops-mcp"
}
```

---

## Resource Inventory (rg-hiacoo-mcp-private)

| Resource | Type | Key Info |
|----------|------|----------|
| `func-pizza-api-onlgvc76rbuge` | Function App (Flex Consumption, Node 22) | System MI: `e19913be-5137-4d1a-bbac-94c117c8e506` |
| `stonlgvc76rbuge` | Storage Account | publicNetworkAccess: **Enabled** |
| `cosmos-onlgvc76rbuge` | Cosmos DB (NoSQL) | publicNetworkAccess: **Enabled** |
| `ca-pizza-mcp-onlgvc76rbuge` | Container App (MCP server) | User MI: `f13251ea-4776-49af-b3ff-78096a2259ee` |
| `cog-onlgvc76rbuge` | Cognitive Services (OpenAI S0) | Enabled, OK |
| `cronlgvc76rbuge` | Container Registry (Basic) | Enabled, OK |
| `id-pizza-mcp-onlgvc76rbuge` | User-Assigned Managed Identity | Used by Container App |
| `asp-onlgvc76rbuge` | App Service Plan (Flex/FC1) | For Function App |
| `log-onlgvc76rbuge` | Log Analytics Workspace | Monitoring |
| `cae-onlgvc76rbuge` | Container Apps Environment | Hosts MCP server |

---

## Azure Policy Note

All policies affecting this RG are **Audit** or **AuditIfNotExists** only — none are **Deny**. They flag but do not block. The fixes above will not be reverted by policy, but may generate audit findings that need to be accepted or exempted.

---

## Deployment Script Template

```bash
#!/bin/bash
# deploy-mcp-infra-fixes.sh
# Run after initial deployment to ensure networking and RBAC are correct

RG="rg-hiacoo-mcp-private"
STORAGE="stonlgvc76rbuge"
COSMOS="cosmos-onlgvc76rbuge"
FUNCAPP="func-pizza-api-onlgvc76rbuge"
# Get Function App system MI principal ID dynamically:
MI_PRINCIPAL=$(az functionapp identity show --name $FUNCAPP --resource-group $RG --query principalId -o tsv)
STORAGE_SCOPE="/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$STORAGE"

echo "1. Enabling public network access on Storage..."
az storage account update --name $STORAGE --resource-group $RG --public-network-access Enabled

echo "2. Granting RBAC roles to Function App MI ($MI_PRINCIPAL)..."
az role assignment create --assignee $MI_PRINCIPAL --role "Storage Blob Data Owner" --scope $STORAGE_SCOPE
az role assignment create --assignee $MI_PRINCIPAL --role "Storage Queue Data Contributor" --scope $STORAGE_SCOPE
az role assignment create --assignee $MI_PRINCIPAL --role "Storage Table Data Contributor" --scope $STORAGE_SCOPE

echo "3. Enabling public network access on Cosmos DB..."
az cosmosdb update --name $COSMOS --resource-group $RG --public-network-access ENABLED

echo "4. Restarting Function App..."
az functionapp restart --name $FUNCAPP --resource-group $RG

echo "5. Verifying Function App health..."
sleep 10
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$FUNCAPP.azurewebsites.net/api/flights/search?date=$(date +%Y-%m-%d)")
echo "   Function App status: $HTTP_STATUS"

if [ "$HTTP_STATUS" = "200" ]; then
  echo "SUCCESS: MCP infrastructure is healthy"
else
  echo "WARNING: Function App returned $HTTP_STATUS — check logs"
fi
```
