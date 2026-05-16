// Bicep parameter file for deploying the eval-service stack into the
// `iqpoc` resource group (subscription e7f1696a-37dd-4876-accb-2facb8713917).
//
// Deploy command:
//   az deployment group create `
//     --resource-group iqpoc `
//     --subscription e7f1696a-37dd-4876-accb-2facb8713917 `
//     --template-file infra/modules/eval-service.bicep `
//     --parameters infra/eval-service.iqpoc.bicepparam
//
// Ref: https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/parameter-files

using './modules/eval-service.bicep'

param location = 'eastus2'

param peSubnetResourceId = '/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/iqpoc/providers/Microsoft.Network/virtualNetworks/vnet-iqpoc/subnets/subnet-pe'
param cosmosDnsZoneResourceId = '/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/iqpoc/providers/Microsoft.Network/privateDnsZones/privatelink.documents.azure.com'

param userAssignedIdentityResourceId = '/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/iqpoc/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-eval-service'
param userAssignedIdentityClientId = '2cf9ca2a-8c77-448e-9e86-c53c3273900f'

param containerAppEnvResourceId = '/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/iqpoc/providers/Microsoft.App/managedEnvironments/cae-storage-proxy'

param acrResourceId = '/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/iqpoc/providers/Microsoft.ContainerRegistry/registries/cronlgvc76rbuge'
param containerImage = 'cronlgvc76rbuge.azurecr.io/eval-service/eval-service:v26'

param foundryProjectEndpoint = 'https://aikb-foundry-q36gpyt3maa7w.services.ai.azure.com/api/projects/aikb-project-q36gpyt3maa7w'
param foundryModelDeployment = 'gpt-4.1-mini'

param cosmosAccountName = 'cosmos-eval-iqpoc'
param cosmosDatabaseName = 'eval-db'
param containerAppName = 'ca-eval-svc-v2'
param pollerIntervalSeconds = 30

// Set via CLI to avoid checking the connection string into source control:
//   --parameters appInsightsConnectionString=$env:APPINSIGHTS_CONNECTION_STRING
param appInsightsConnectionString = ''
