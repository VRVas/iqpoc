// Parameters for `iqpoc` resource group (subscription e7f1696a-37dd-4876-accb-2facb8713917).
// All values mirror the current live state. Running `what-if` against the RG
// with this template + parameter file should report zero structural changes.
//
// Deploy command:
//   az deployment group create `
//     --resource-group iqpoc `
//     --subscription e7f1696a-37dd-4876-accb-2facb8713917 `
//     --template-file infra/main-iqpoc.bicep `
//     --parameters infra/main-iqpoc.bicepparam
//
// what-if (recommended before deploy):
//   az deployment group what-if `
//     --resource-group iqpoc `
//     --subscription e7f1696a-37dd-4876-accb-2facb8713917 `
//     --template-file infra/main-iqpoc.bicep `
//     --parameters infra/main-iqpoc.bicepparam
//
// Ref: https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/parameter-files

using './main-iqpoc.bicep'

param location = 'eastus2'
param staticWebAppLocation = 'eastus2'

// Pre-existing names (do not change without coordinating a re-deploy).
param vnetName = 'vnet-iqpoc'
param searchServiceName = 'aikb-search-q36gpyt3maa7w'
param storageAccountName = 'aikbstorageq36gpyt3maa7w'
param foundryAccountName = 'aikb-foundry-q36gpyt3maa7w'
param foundryProjectName = 'proj-iqpoc'
param staticWebAppName = 'aikb-web-q36gpyt3maa7w'
param logAnalyticsName = 'log-eval-iqpoc'
param appInsightsName = 'appi-eval-iqpoc'
param cosmosAccountName = 'cosmos-eval-iqpoc'
param cosmosPrivateEndpointName = 'pe-cosmos-iqpoc'
param vnetCaeName = 'cae-storage-proxy'
param legacyCaeName = 'cae-eval-iqpoc'
param evalServiceAppName = 'ca-eval-svc-v2'
param storageProxyAppName = 'ca-storage-proxy'
param evalServiceIdentityName = 'id-eval-service'
param storageProxyIdentityName = 'id-storage-proxy'

// External ACR (lives in rg-hiacoo-mcp-private, swedencentral).
param acrResourceId = '/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/rg-hiacoo-mcp-private/providers/Microsoft.ContainerRegistry/registries/cronlgvc76rbuge'

param evalServiceImage = 'cronlgvc76rbuge.azurecr.io/eval-service/eval-service:v26'
param storageProxyImage = 'cronlgvc76rbuge.azurecr.io/storage-proxy:v2'

// SWA wired to GitHub `main`. Supply repository token via CLI when (re)linking.
param swaRepositoryUrl = 'https://github.com/VRVas/iqpoc'
param swaBranch = 'main'
param swaRepositoryToken = ''
