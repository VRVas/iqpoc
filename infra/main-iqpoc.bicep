// End-to-end IaC for the `iqpoc` resource group: VNet, NSGs, private DNS,
// private endpoints, Cosmos, Container Apps environments + apps, Storage,
// Static Web App, Azure AI Search, AI Services (Foundry) account with all
// model deployments, identity, and observability.
//
// This template is a faithful representation of the current `iqpoc` state.
// Running `az deployment group what-if` against the live RG should report
// zero structural changes (modulo cosmetic property defaults).
//
// References (MS Learn):
//   - Bicep module composition:
//       https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/modules
//   - what-if for IaC drift detection:
//       https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-what-if

targetScope = 'resourceGroup'

@description('Azure region used for every resource in this RG (DNS zones are global).')
param location string = resourceGroup().location

@description('Tag map applied to every resource.')
param tags object = {
  environment: 'demo'
  solution: 'foundry-iq-demo'
  managedBy: 'Bicep'
  SecurityControl: 'Ignore'
  SecurityGroup: 'Ignore'
}

// ---------- Naming ----------
@description('Virtual network name.')
param vnetName string = 'vnet-iqpoc'

@description('AI Search service name.')
param searchServiceName string = 'aikb-search-q36gpyt3maa7w'

@description('Storage account name.')
param storageAccountName string = 'aikbstorageq36gpyt3maa7w'

@description('AI Services (Foundry) account name.')
param foundryAccountName string = 'aikb-foundry-q36gpyt3maa7w'

@description('Foundry project name (child of the AIServices account).')
param foundryProjectName string = 'proj-iqpoc'

@description('Static Web App name.')
param staticWebAppName string = 'aikb-web-q36gpyt3maa7w'

@description('Static Web App region — must be one of the SWA-supported regions.')
param staticWebAppLocation string = 'eastus2'

@description('Log Analytics workspace name.')
param logAnalyticsName string = 'log-eval-iqpoc'

@description('Application Insights resource name.')
param appInsightsName string = 'appi-eval-iqpoc'

@description('Cosmos DB account name.')
param cosmosAccountName string = 'cosmos-eval-iqpoc'

@description('Existing private endpoint name for the Cosmos account. Live resource is named `pe-cosmos-iqpoc` (predates eval rename).')
param cosmosPrivateEndpointName string = 'pe-cosmos-iqpoc'

@description('VNet-injected Container Apps environment name.')
param vnetCaeName string = 'cae-storage-proxy'

@description('Legacy non-VNet Container Apps environment name (kept until ca-eval-service is decommissioned).')
param legacyCaeName string = 'cae-eval-iqpoc'

@description('eval-service container app name.')
param evalServiceAppName string = 'ca-eval-svc-v2'

@description('storage-proxy container app name.')
param storageProxyAppName string = 'ca-storage-proxy'

@description('UAMI used by eval-service.')
param evalServiceIdentityName string = 'id-eval-service'

@description('UAMI used by storage-proxy.')
param storageProxyIdentityName string = 'id-storage-proxy'

// ---------- External (read-only) references ----------
@description('Resource ID of the shared ACR (lives in another resource group/subscription).')
param acrResourceId string = '/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/rg-hiacoo-mcp-private/providers/Microsoft.ContainerRegistry/registries/cronlgvc76rbuge'

// ---------- Container images ----------
@description('eval-service container image tag.')
param evalServiceImage string = 'cronlgvc76rbuge.azurecr.io/eval-service/eval-service:v26'

@description('storage-proxy container image tag.')
param storageProxyImage string = 'cronlgvc76rbuge.azurecr.io/storage-proxy:v2'

// ---------- SWA ----------
@description('GitHub repository URL for the SWA.')
param swaRepositoryUrl string = 'https://github.com/VRVas/iqpoc'

@description('GitHub branch tracked by the SWA.')
param swaBranch string = 'main'

@description('GitHub PAT for the SWA. Leave empty to skip linking; supply via deployment to (re)link the repo.')
@secure()
param swaRepositoryToken string = ''

// ---------- Foundry ----------
@description('Foundry / AI Services model deployments (kept in sync with the live account).')
param foundryModelDeployments array = [
  { name: 'text-embedding-3-small', model: 'text-embedding-3-small', version: '1', sku: 'Standard', capacity: 210 }
  { name: 'gpt-4o-mini', model: 'gpt-4.1-mini', version: '2025-04-14', sku: 'Standard', capacity: 420 }
  { name: 'gpt-5', model: 'gpt-5', version: '2025-08-07', sku: 'DataZoneStandard', capacity: 300 }
  { name: 'gpt-5.2', model: 'gpt-5.2', version: '2025-12-11', sku: 'DataZoneStandard', capacity: 300 }
  { name: 'text-embedding-3-large', model: 'text-embedding-3-large', version: '1', sku: 'Standard', capacity: 230 }
  { name: 'gpt-4.1', model: 'gpt-4.1', version: '2025-04-14', sku: 'Standard', capacity: 500 }
  { name: 'gpt-4.1-mini', model: 'gpt-4.1-mini', version: '2025-04-14', sku: 'Standard', capacity: 500 }
  { name: 'gpt-5.4-mini', model: 'gpt-5.4-mini', version: '2026-03-17', sku: 'GlobalStandard', capacity: 1000 }
]

// ---------- Misc ----------
@description('Default model deployment used by the eval-service.')
param foundryModelDeployment string = 'gpt-4.1-mini'

@description('Background poller interval (seconds).')
param evalPollerIntervalSeconds int = 30

// ===========================================================================
// Modules
// ===========================================================================

module network 'modules/network.bicep' = {
  name: 'deploy-network'
  params: {
    location: location
    vnetName: vnetName
    tags: tags
  }
}

module observability 'modules/observability.bicep' = {
  name: 'deploy-observability'
  params: {
    location: location
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
    webTestUrl: 'https://${staticWebApp.outputs.defaultHostname}/api/warmup'
    tags: tags
  }
}

module identity 'modules/identity.bicep' = {
  name: 'deploy-identity'
  params: {
    location: location
    evalServiceIdentityName: evalServiceIdentityName
    storageProxyIdentityName: storageProxyIdentityName
    tags: tags
  }
}

// Re-declare LAW as `existing` so we can call listKeys() to fetch the shared
// key in this same template (Bicep cannot output secrets across module
// boundaries trivially).
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
  dependsOn: [
    observability
  ]
}

module cae 'modules/container-apps-env.bicep' = {
  name: 'deploy-cae'
  params: {
    location: location
    legacyEnvName: legacyCaeName
    vnetEnvName: vnetCaeName
    caeSubnetId: network.outputs.caeSubnetId
    logAnalyticsCustomerId: workspace.properties.customerId
    logAnalyticsSharedKey: workspace.listKeys().primarySharedKey
    tags: tags
  }
}

module search 'modules/search.bicep' = {
  name: 'deploy-search'
  params: {
    searchServiceName: searchServiceName
    location: location
    sku: 'basic'
    tags: tags
  }
}

module storage 'modules/storage.bicep' = {
  name: 'deploy-storage'
  params: {
    storageAccountName: storageAccountName
    location: location
    sku: 'Standard_LRS'
    tags: tags
    publicNetworkAccess: 'Disabled'
    networkAclDefaultAction: 'Allow'
    sampleDataContainerName: 'sample-documents'
  }
}

module storagePe 'modules/storage-pe.bicep' = {
  name: 'deploy-storage-pe'
  params: {
    location: location
    storageAccountName: storageAccountName
    peSubnetResourceId: network.outputs.peSubnetId
    blobDnsZoneId: network.outputs.blobDnsZoneId
    tags: tags
  }
  dependsOn: [
    storage
  ]
}

module foundry 'modules/foundry-aiservices.bicep' = {
  name: 'deploy-foundry'
  params: {
    location: location
    accountName: foundryAccountName
    projectName: foundryProjectName
    projectDisplayName: foundryProjectName
    projectDescription: 'Foundry IQ demo project.'
    modelDeployments: foundryModelDeployments
    publicNetworkAccess: 'Enabled'
    tags: tags
  }
}

module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'deploy-staticwebapp'
  params: {
    staticWebAppName: staticWebAppName
    location: staticWebAppLocation
    sku: 'Standard'
    repositoryUrl: swaRepositoryUrl
    branch: swaBranch
    repositoryToken: swaRepositoryToken
    tags: tags
  }
}

module storageProxy 'modules/storage-proxy.bicep' = {
  name: 'deploy-storage-proxy'
  params: {
    location: location
    containerAppName: storageProxyAppName
    containerAppEnvResourceId: cae.outputs.vnetEnvId
    containerImage: storageProxyImage
    userAssignedIdentityResourceId: identity.outputs.storageProxyIdentityId
    userAssignedIdentityClientId: identity.outputs.storageProxyIdentityClientId
    userAssignedIdentityPrincipalId: identity.outputs.storageProxyIdentityPrincipalId
    acrResourceId: acrResourceId
    storageAccountName: storageAccountName
    tags: tags
  }
  dependsOn: [
    storage
  ]
}

module evalService 'modules/eval-service.bicep' = {
  name: 'deploy-eval-service'
  params: {
    location: location
    peSubnetResourceId: network.outputs.peSubnetId
    cosmosDnsZoneResourceId: network.outputs.cosmosDnsZoneId
    userAssignedIdentityResourceId: identity.outputs.evalServiceIdentityId
    userAssignedIdentityClientId: identity.outputs.evalServiceIdentityClientId
    containerAppEnvResourceId: cae.outputs.vnetEnvId
    containerImage: evalServiceImage
    acrResourceId: acrResourceId
    foundryProjectEndpoint: foundry.outputs.projectEndpoint
    foundryModelDeployment: foundryModelDeployment
    appInsightsConnectionString: observability.outputs.appInsightsConnectionString
    cosmosAccountName: cosmosAccountName
    cosmosPrivateEndpointName: cosmosPrivateEndpointName
    cosmosDatabaseName: 'eval-db'
    containerAppName: evalServiceAppName
    pollerIntervalSeconds: evalPollerIntervalSeconds
  }
}

// ===========================================================================
// Outputs
// ===========================================================================

output vnetId string = network.outputs.vnetId
output caeSubnetId string = network.outputs.caeSubnetId
output peSubnetId string = network.outputs.peSubnetId
output cosmosDnsZoneId string = network.outputs.cosmosDnsZoneId
output blobDnsZoneId string = network.outputs.blobDnsZoneId

output workspaceId string = observability.outputs.workspaceId
output appInsightsId string = observability.outputs.appInsightsId
output appInsightsConnectionString string = observability.outputs.appInsightsConnectionString
output webTestId string = observability.outputs.webTestId

output legacyCaeId string = cae.outputs.legacyEnvId
output vnetCaeId string = cae.outputs.vnetEnvId

output evalServiceIdentityId string = identity.outputs.evalServiceIdentityId
output storageProxyIdentityId string = identity.outputs.storageProxyIdentityId

output searchServiceId string = search.outputs.searchServiceId
output searchEndpoint string = search.outputs.searchEndpoint

output storageAccountId string = storage.outputs.storageAccountId
output storagePeId string = storagePe.outputs.privateEndpointId

output foundryAccountId string = foundry.outputs.accountId
output foundryProjectEndpoint string = foundry.outputs.projectEndpoint

output staticWebAppUrl string = staticWebApp.outputs.staticWebAppUrl

output storageProxyUrl string = storageProxy.outputs.storageProxyUrl
output evalServiceUrl string = evalService.outputs.evalServiceUrl
