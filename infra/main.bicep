// ===========================================================================
// Foundry IQ demo — azd `up`-ready subscription-scope orchestrator
// ===========================================================================
//
// This file is the entrypoint consumed by `azd up`. It provisions a fresh
// resource group and all services needed to run the demo in any subscription:
//
//   - VNet (CAE-delegated subnet + PE subnet + NSGs + Cosmos/Blob DNS zones)
//   - Two user-assigned identities (eval-service, storage-proxy)
//   - Log Analytics + Application Insights + classic ping availability test
//   - In-RG Azure Container Registry (greenfield-only)
//   - VNet-injected Container Apps managed environment
//   - Azure AI Search (basic SKU)
//   - Azure Storage Account (+ blob private endpoint)
//   - Azure AI Foundry (AIServices kind) account + project + model deployments
//   - Static Web App (Standard, no GitHub wiring — azd deploys content)
//   - Container Apps: ca-storage-proxy + ca-eval-svc-v2 (image preservation
//     via the `*AppExists` flags so `azd provision` never resets a deployed
//     image)
//
// Naming convention: all resource names follow the canonical azd pattern
//   `<prefix><resourceToken>` where `resourceToken = uniqueString(sub, env, loc)`.
// Globally-unique names (ACR, storage, Foundry custom subdomain) use the
// resourceToken directly. Long-lived demo names (vnet, identities) use
// `<prefix>${environmentName}` so they read clearly in the portal.
//
// References:
//   azd schema:                https://learn.microsoft.com/azure/developer/azure-developer-cli/azd-schema
//   azd Bicep best practices:  https://learn.microsoft.com/azure/developer/azure-developer-cli/make-azd-compatible
//   Bicep best practices:      https://learn.microsoft.com/azure/azure-resource-manager/bicep/best-practices
// ===========================================================================

targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment. Used for the resource group name and as a uniqueness seed.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Object ID of the user or service principal that should receive demo RBAC (Storage Blob Data Contributor, Cosmos Data Contributor, etc.). azd populates this automatically from AZURE_PRINCIPAL_ID.')
param principalId string = ''

// ---------------------------------------------------------------------------
// Optional naming overrides — leave at defaults to use the canonical azd
// `<prefix>${environmentName}` / `<prefix>${resourceToken}` patterns.
// ---------------------------------------------------------------------------
param resourceGroupName string = ''
param logAnalyticsName string = ''
param appInsightsName string = ''
param vnetName string = ''
param acrName string = ''
param containerAppsEnvironmentName string = ''
param searchServiceName string = ''
param storageAccountName string = ''
param foundryAccountName string = ''
param foundryProjectName string = 'proj-${take(replace(environmentName, '_', '-'), 40)}'
param staticWebAppName string = ''
param evalServiceIdentityName string = ''
param storageProxyIdentityName string = ''
param storageProxyAppName string = 'ca-storage-proxy'
param evalServiceAppName string = 'ca-eval-svc'
param cosmosAccountName string = ''

// ---------------------------------------------------------------------------
// azd "exists" flags — surfaced via `${SERVICE_<NAME>_RESOURCE_EXISTS=false}`
// in main.parameters.json. azd flips these to true after the first successful
// deploy so subsequent `azd provision` runs preserve the live image.
// ---------------------------------------------------------------------------
@description('Set to true after the first `azd deploy storage-proxy`. azd manages this automatically via SERVICE_STORAGE_PROXY_RESOURCE_EXISTS.')
param storageProxyAppExists bool = false

@description('Set to true after the first `azd deploy eval-service`. azd manages this automatically via SERVICE_EVAL_SERVICE_RESOURCE_EXISTS.')
param evalServiceAppExists bool = false

// ---------------------------------------------------------------------------
// Static Web App — optional GitHub wiring (only for legacy GH-Actions flow).
// Leave repositoryToken empty in the greenfield azd path so the SWA is
// content-deployable via `azd deploy web`.
// ---------------------------------------------------------------------------
@description('GitHub repository URL. Leave empty to skip GitHub provider wiring (azd deploy mode).')
param staticWebAppRepositoryUrl string = ''

@description('GitHub repository token. Leave empty to skip GitHub provider wiring.')
@secure()
param staticWebAppRepositoryToken string = ''

@description('Static Web App location. SWA is GA in: westus2, centralus, eastus2, westeurope, eastasia.')
@allowed([
  'westus2'
  'centralus'
  'eastus2'
  'westeurope'
  'eastasia'
])
param staticWebAppLocation string = 'eastus2'

// ---------------------------------------------------------------------------
// Foundry model deployments — defaults match the iqpoc demo footprint.
// ---------------------------------------------------------------------------
@description('Foundry/AIServices model deployments. Defaults to the two chat models used by the eval-service and front-end. Add a text-embedding-3-small entry if your subscription has TPM quota and you need embeddings.')
param foundryModelDeployments array = [
  {
    name: 'gpt-4o-mini'
    model: 'gpt-4o-mini'
    version: '2024-07-18'
    sku: 'GlobalStandard'
    capacity: 30
  }
  {
    name: 'gpt-4.1-mini'
    model: 'gpt-4.1-mini'
    version: '2025-04-14'
    sku: 'GlobalStandard'
    capacity: 30
  }
]

// ---------------------------------------------------------------------------
// Computed values
// ---------------------------------------------------------------------------
var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
}

var effectiveResourceGroupName = !empty(resourceGroupName) ? resourceGroupName : '${abbrs.resourcesResourceGroups}${environmentName}'
var effectiveLogAnalyticsName = !empty(logAnalyticsName) ? logAnalyticsName : '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
var effectiveAppInsightsName = !empty(appInsightsName) ? appInsightsName : '${abbrs.insightsComponents}${resourceToken}'
var effectiveVnetName = !empty(vnetName) ? vnetName : '${abbrs.networkVirtualNetworks}${environmentName}'
var effectiveAcrName = !empty(acrName) ? acrName : '${abbrs.containerRegistryRegistries}${resourceToken}'
var effectiveCaeName = !empty(containerAppsEnvironmentName) ? containerAppsEnvironmentName : '${abbrs.appManagedEnvironments}${environmentName}'
var effectiveSearchName = !empty(searchServiceName) ? searchServiceName : '${abbrs.searchSearchServices}${resourceToken}'
var effectiveStorageName = !empty(storageAccountName) ? storageAccountName : '${abbrs.storageStorageAccounts}${resourceToken}'
var effectiveFoundryAccountName = !empty(foundryAccountName) ? foundryAccountName : '${abbrs.cognitiveServicesAccounts}${resourceToken}'
var effectiveStaticWebAppName = !empty(staticWebAppName) ? staticWebAppName : '${abbrs.webStaticSites}${resourceToken}'
var effectiveEvalIdentityName = !empty(evalServiceIdentityName) ? evalServiceIdentityName : '${abbrs.managedIdentityUserAssignedIdentities}eval-${resourceToken}'
var effectiveStorageProxyIdentityName = !empty(storageProxyIdentityName) ? storageProxyIdentityName : '${abbrs.managedIdentityUserAssignedIdentities}proxy-${resourceToken}'
var effectiveCosmosName = !empty(cosmosAccountName) ? cosmosAccountName : '${abbrs.documentDBDatabaseAccounts}${resourceToken}'

// ---------------------------------------------------------------------------
// Resource Group
// ---------------------------------------------------------------------------
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: effectiveResourceGroupName
  location: location
  tags: tags
}

// ---------------------------------------------------------------------------
// Network — VNet, subnets, NSGs, private DNS zones (Cosmos + Blob)
// ---------------------------------------------------------------------------
module network './modules/network.bicep' = {
  name: 'deploy-network'
  scope: rg
  params: {
    location: location
    vnetName: effectiveVnetName
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Managed identities for the two container apps
// ---------------------------------------------------------------------------
module identity './modules/identity.bicep' = {
  name: 'deploy-identity'
  scope: rg
  params: {
    location: location
    evalServiceIdentityName: effectiveEvalIdentityName
    storageProxyIdentityName: effectiveStorageProxyIdentityName
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Observability — Log Analytics, App Insights, classic ping web test
// ---------------------------------------------------------------------------
module observability './modules/observability.bicep' = {
  name: 'deploy-observability'
  scope: rg
  params: {
    location: location
    logAnalyticsName: effectiveLogAnalyticsName
    appInsightsName: effectiveAppInsightsName
    // Web test target: the Static Web App default hostname (assembled below).
    // We can't reference `staticWebApp.outputs.*` until that module runs, so
    // we precompute the canonical SWA hostname pattern as a placeholder.
    // (azd doesn't require an actual healthy probe; this just provisions the
    // test in App Insights so users can wire it later.)
    webTestUrl: 'https://${effectiveStaticWebAppName}.azurestaticapps.net/'
    webTestMatchText: 'html'
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// In-RG Container Registry — azd builds + pushes images here
// ---------------------------------------------------------------------------
module acr './modules/container-registry.bicep' = {
  name: 'deploy-acr'
  scope: rg
  params: {
    acrName: effectiveAcrName
    location: location
    sku: 'Basic'
    tags: tags
    acrPullPrincipalIds: [
      identity.outputs.evalServiceIdentityPrincipalId
      identity.outputs.storageProxyIdentityPrincipalId
    ]
  }
}

// ---------------------------------------------------------------------------
// Container Apps managed environment (VNet-injected only — no legacy env)
// ---------------------------------------------------------------------------
module cae './modules/container-apps-env.bicep' = {
  name: 'deploy-cae'
  scope: rg
  params: {
    location: location
    vnetEnvName: effectiveCaeName
    caeSubnetId: network.outputs.caeSubnetId
    logAnalyticsWorkspaceName: observability.outputs.workspaceName
    deployLegacyEnv: false
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Azure AI Search
// ---------------------------------------------------------------------------
module search './modules/search.bicep' = {
  name: 'deploy-search'
  scope: rg
  params: {
    location: location
    searchServiceName: effectiveSearchName
    sku: 'basic'
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Storage account
// ---------------------------------------------------------------------------
module storage './modules/storage.bicep' = {
  name: 'deploy-storage'
  scope: rg
  params: {
    location: location
    storageAccountName: effectiveStorageName
    tags: tags
    publicNetworkAccess: 'Enabled'
    networkAclDefaultAction: 'Allow'
  }
}

// Blob private endpoint (uses the blob DNS zone owned by network.bicep)
module storagePe './modules/storage-pe.bicep' = {
  name: 'deploy-storage-pe'
  scope: rg
  params: {
    location: location
    storageAccountName: storage.outputs.storageAccountName
    peSubnetResourceId: network.outputs.peSubnetId
    blobDnsZoneId: network.outputs.blobDnsZoneId
    privateEndpointName: 'pe-${effectiveStorageName}'
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Azure AI Foundry — AIServices account + project + model deployments
// ---------------------------------------------------------------------------
module foundry './modules/foundry-aiservices.bicep' = {
  name: 'deploy-foundry'
  scope: rg
  params: {
    location: location
    accountName: effectiveFoundryAccountName
    projectName: foundryProjectName
    projectDisplayName: environmentName
    projectDescription: 'Foundry IQ demo project for azd env ${environmentName}.'
    modelDeployments: foundryModelDeployments
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Static Web App (Next.js front-end)
// ---------------------------------------------------------------------------
module staticWebApp './modules/staticwebapp.bicep' = {
  name: 'deploy-static-web-app'
  scope: rg
  params: {
    staticWebAppName: effectiveStaticWebAppName
    location: staticWebAppLocation
    sku: 'Standard'
    repositoryUrl: staticWebAppRepositoryUrl
    repositoryToken: staticWebAppRepositoryToken
    tags: union(tags, { 'azd-service-name': 'web' })
  }
}

// ---------------------------------------------------------------------------
// Container App: storage-proxy (VNet-injected)
// ---------------------------------------------------------------------------
module storageProxy './modules/storage-proxy.bicep' = {
  name: 'deploy-storage-proxy'
  scope: rg
  params: {
    location: location
    containerAppName: storageProxyAppName
    containerAppEnvResourceId: cae.outputs.vnetEnvId
    containerAppExists: storageProxyAppExists
    userAssignedIdentityResourceId: identity.outputs.storageProxyIdentityId
    userAssignedIdentityClientId: identity.outputs.storageProxyIdentityClientId
    userAssignedIdentityPrincipalId: identity.outputs.storageProxyIdentityPrincipalId
    acrResourceId: acr.outputs.acrId
    acrLoginServer: acr.outputs.loginServer
    storageAccountName: storage.outputs.storageAccountName
    // ACR is in the same RG as the container app → AcrPull RBAC is handled
    // inside the container-registry module (acrPullPrincipalIds). Skip here
    // to avoid duplicate role assignments.
    manageAcrPullRoleAssignment: false
    tags: union(tags, { 'azd-service-name': 'storage-proxy' })
  }
}

// ---------------------------------------------------------------------------
// Container App: eval-service (FastAPI on VNet-injected CAE + Cosmos DB + PE)
// ---------------------------------------------------------------------------
module evalService './modules/eval-service.bicep' = {
  name: 'deploy-eval-service'
  scope: rg
  params: {
    location: location
    peSubnetResourceId: network.outputs.peSubnetId
    cosmosDnsZoneResourceId: network.outputs.cosmosDnsZoneId
    userAssignedIdentityResourceId: identity.outputs.evalServiceIdentityId
    userAssignedIdentityClientId: identity.outputs.evalServiceIdentityClientId
    containerAppEnvResourceId: cae.outputs.vnetEnvId
    containerAppName: evalServiceAppName
    containerAppExists: evalServiceAppExists
    acrResourceId: acr.outputs.acrId
    acrLoginServer: acr.outputs.loginServer
    manageAcrPullRoleAssignment: false
    foundryProjectEndpoint: foundry.outputs.projectEndpoint
    foundryModelDeployment: 'gpt-4.1-mini'
    appInsightsConnectionString: observability.outputs.appInsightsConnectionString
    cosmosAccountName: effectiveCosmosName
    cosmosPrivateEndpointName: 'pe-${effectiveCosmosName}'
  }
}

// ---------------------------------------------------------------------------
// Developer RBAC — grant the human running `azd up` data-plane access to
// the demo resources so they can hit them directly from their workstation.
// ---------------------------------------------------------------------------
module developerRbac './modules/developer-rbac.bicep' = if (!empty(principalId)) {
  name: 'deploy-developer-rbac'
  scope: rg
  params: {
    principalId: principalId
    principalType: 'User'
    storageAccountName: storage.outputs.storageAccountName
    searchServiceName: search.outputs.searchServiceName
    aiServicesAccountName: foundry.outputs.accountName
    acrName: acr.outputs.acrName
  }
}

// ===========================================================================
// Outputs — azd writes these to .azure/<env>/.env after every provision
// ===========================================================================
output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = rg.name

// Container apps / ACR
output AZURE_CONTAINER_REGISTRY_NAME string = acr.outputs.acrName
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.outputs.loginServer
output AZURE_CONTAINER_ENVIRONMENT_NAME string = cae.outputs.vnetEnvName
output AZURE_CONTAINER_ENVIRONMENT_DEFAULT_DOMAIN string = cae.outputs.vnetEnvDefaultDomain

// Service URIs / names (azd-service-name aware)
output SERVICE_WEB_NAME string = staticWebApp.outputs.staticWebAppName
output SERVICE_WEB_URI string = staticWebApp.outputs.staticWebAppUrl
output SERVICE_STORAGE_PROXY_NAME string = storageProxyAppName
output SERVICE_STORAGE_PROXY_URI string = storageProxy.outputs.storageProxyUrl
output SERVICE_EVAL_SERVICE_NAME string = evalServiceAppName
output SERVICE_EVAL_SERVICE_URI string = evalService.outputs.evalServiceUrl

// Observability
output APPLICATIONINSIGHTS_CONNECTION_STRING string = observability.outputs.appInsightsConnectionString
output APPLICATIONINSIGHTS_NAME string = observability.outputs.appInsightsName
output AZURE_LOG_ANALYTICS_WORKSPACE_NAME string = observability.outputs.workspaceName

// Search
output AZURE_SEARCH_ENDPOINT string = search.outputs.searchEndpoint
output AZURE_SEARCH_SERVICE_NAME string = search.outputs.searchServiceName

// Storage
output AZURE_STORAGE_ACCOUNT_NAME string = storage.outputs.storageAccountName
output AZURE_STORAGE_PRIMARY_BLOB_ENDPOINT string = storage.outputs.storageAccountPrimaryEndpoint

// Foundry
output AZURE_AISERVICES_ACCOUNT_NAME string = foundry.outputs.accountName
output AZURE_AISERVICES_ACCOUNT_ENDPOINT string = foundry.outputs.accountEndpoint
output FOUNDRY_PROJECT_NAME string = foundry.outputs.projectName
output FOUNDRY_PROJECT_ENDPOINT string = foundry.outputs.projectEndpoint

// Cosmos (eval-service)
output AZURE_COSMOS_ACCOUNT_NAME string = effectiveCosmosName
output AZURE_COSMOS_ENDPOINT string = evalService.outputs.cosmosEndpoint
