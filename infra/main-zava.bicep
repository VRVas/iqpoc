// Per-tenant IaC for the Zava deployment, layered on top of the shared
// resources provisioned by main-iqpoc.bicep. This template ONLY provisions
// the slice of infrastructure that must be isolated per tenant:
//
//   - 2 user-assigned managed identities (id-eval-service-zava, id-storage-proxy-zava)
//   - A dedicated Foundry project (proj-zava) inside the shared AI Services account
//   - A dedicated Cosmos SQL database (eval-db-zava) inside the shared Cosmos account
//   - 2 container apps (ca-eval-svc-zava, ca-storage-proxy-zava) inside the
//     shared VNet-injected Container Apps environment
//   - A dedicated Static Web App (aikb-web-zava-<token>)
//   - A dedicated Application Insights resource (appi-eval-zava) linked to
//     the shared Log Analytics workspace
//
// Everything else (VNet, NSGs, private DNS, AI Search, Storage account,
// AI Services account, Container Apps environments, Log Analytics workspace,
// shared Cosmos DB account + private endpoint + DNS zone group) is consumed
// as `existing` from the resources already deployed by main-iqpoc.bicep.
//
// Run order:
//   1. `az deployment group create -g iqpoc -f infra/main-iqpoc.bicep -p infra/main-iqpoc.bicepparam`
//      (Qatar baseline — must succeed first)
//   2. `az deployment group create -g iqpoc -f infra/main-zava.bicep -p infra/main-zava.bicepparam`
//      (Zava additive deployment — depends on (1))
//
// References (MS Learn):
//   Bicep `existing` references for shared resources:
//     https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/existing-resource
//   what-if drift detection (run before any apply):
//     https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-what-if

targetScope = 'resourceGroup'

// ===========================================================================
// Parameters
// ===========================================================================

@description('Azure region for tenant-specific Azure resources (must match the shared resources in this RG).')
param location string = resourceGroup().location

@description('Tag map applied to every tenant-scoped resource. Includes a `tenant` tag for billing/inventory queries.')
param tags object = {
  environment: 'demo'
  solution: 'foundry-iq-demo'
  managedBy: 'Bicep'
  SecurityControl: 'Ignore'
  SecurityGroup: 'Ignore'
  tenant: 'zava'
}

@description('Tenant id — surfaced as TENANT_ID inside the eval-service container so the FastAPI router can gate tenant-specific evaluators.')
param tenantId string = 'zava'

// ---------- Shared (existing) resources referenced from main-iqpoc.bicep ----------

@description('Existing AI Services (Foundry) account that will host the per-tenant Foundry project.')
param foundryAccountName string = 'aikb-foundry-q36gpyt3maa7w'

@description('Existing Cosmos DB account that will host the per-tenant SQL database.')
param cosmosAccountName string = 'cosmos-eval-iqpoc'

@description('Existing Storage account name (used by ca-storage-proxy-zava for blob data plane access).')
param storageAccountName string = 'aikbstorageq36gpyt3maa7w'

@description('Existing Log Analytics workspace name (the per-tenant Application Insights resource links to this workspace).')
param logAnalyticsName string = 'log-eval-iqpoc'

@description('Existing VNet-injected Container Apps environment name.')
param vnetCaeName string = 'cae-storage-proxy'

@description('Resource ID of the shared ACR (lives in another resource group/subscription). The tenant UAMIs receive AcrPull on the ACR scope out-of-band.')
param acrResourceId string = '/subscriptions/e7f1696a-37dd-4876-accb-2facb8713917/resourceGroups/rg-hiacoo-mcp-private/providers/Microsoft.ContainerRegistry/registries/cronlgvc76rbuge'

// ---------- Per-tenant naming ----------

@description('Foundry project name for this tenant.')
param foundryProjectName string = 'proj-zava'

@description('Cosmos SQL database name for this tenant.')
param cosmosDatabaseName string = 'eval-db-zava'

@description('Tenant-scoped UAMI for eval-service.')
param evalServiceIdentityName string = 'id-eval-service-zava'

@description('Tenant-scoped UAMI for storage-proxy.')
param storageProxyIdentityName string = 'id-storage-proxy-zava'

@description('Tenant-scoped eval-service Container App name.')
param evalServiceAppName string = 'ca-eval-svc-zava'

@description('Tenant-scoped storage-proxy Container App name.')
param storageProxyAppName string = 'ca-storage-proxy-zava'

@description('Tenant-scoped Application Insights resource name.')
param appInsightsName string = 'appi-eval-zava'

@description('Tenant-scoped Static Web App name. Default uses the shared rg uniqueness token suffix so successive deployments do not collide.')
param staticWebAppName string = 'aikb-web-zava-${uniqueString(resourceGroup().id, tenantId)}'

@description('Static Web App region — must be one of the SWA-supported regions.')
param staticWebAppLocation string = 'eastus2'

// ---------- Container images ----------

@description('eval-service container image tag.')
param evalServiceImage string = 'cronlgvc76rbuge.azurecr.io/eval-service/eval-service:v26'

@description('storage-proxy container image tag.')
param storageProxyImage string = 'cronlgvc76rbuge.azurecr.io/storage-proxy:v2'

@description('When true (azd handoff), preserve the live container app image across redeploys.')
param evalServiceAppExists bool = false

@description('When true (azd handoff), preserve the live storage-proxy image across redeploys.')
param storageProxyAppExists bool = false

// ---------- SWA wiring ----------

@description('GitHub repository URL for the SWA. Leave empty for azd-deploy mode.')
param swaRepositoryUrl string = ''

@description('GitHub branch tracked by the SWA.')
param swaBranch string = 'main'

@description('GitHub PAT for the SWA. Leave empty to skip linking; supply via deployment to (re)link the repo.')
@secure()
param swaRepositoryToken string = ''

// ---------- Misc ----------

@description('Default model deployment used by the tenant eval-service.')
param foundryModelDeployment string = 'gpt-4.1-mini'

@description('Background poller interval (seconds).')
param evalPollerIntervalSeconds int = 30

// ===========================================================================
// Existing references (shared resources provisioned by main-iqpoc.bicep)
// ===========================================================================

resource sharedFoundryAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: foundryAccountName
}

resource sharedWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource sharedCae 'Microsoft.App/managedEnvironments@2024-10-02-preview' existing = {
  name: vnetCaeName
}

// ===========================================================================
// Per-tenant modules
// ===========================================================================

// 1. Per-tenant managed identities. Reuses the multi-UAMI identity module so
//    we keep a single source of truth for UAMI shape; just names differ.
module tenantIdentity 'modules/identity.bicep' = {
  name: 'deploy-tenant-identity-${tenantId}'
  params: {
    location: location
    evalServiceIdentityName: evalServiceIdentityName
    storageProxyIdentityName: storageProxyIdentityName
    tags: tags
  }
}

// 2. Per-tenant Foundry project (Ring 1 of data isolation: agents + threads +
//    KB connections live in this project and are invisible to other tenants).
module tenantProject 'modules/foundry-project.bicep' = {
  name: 'deploy-tenant-project-${tenantId}'
  params: {
    location: location
    accountName: foundryAccountName
    projectName: foundryProjectName
    projectDisplayName: foundryProjectName
    projectDescription: 'Foundry IQ tenant project for ${tenantId}.'
    tags: tags
  }
  dependsOn: [
    sharedFoundryAccount
  ]
}

// 3. Per-tenant Application Insights linked to the shared Log Analytics workspace.
//    No web availability test (the shared one in main-iqpoc.bicep already pings
//    the Qatar SWA — add a tenant-specific webtest later if needed).
resource tenantAppInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: sharedWorkspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// 4. Per-tenant Cosmos database (Ring 3: tenant data lives in its own database
//    namespace inside the shared Cosmos account). The module also grants the
//    tenant UAMI Cosmos data-plane RBAC scoped to ONLY this database.
module tenantCosmos 'modules/tenant-cosmos-database.bicep' = {
  name: 'deploy-tenant-cosmos-${tenantId}'
  params: {
    cosmosAccountName: cosmosAccountName
    databaseName: cosmosDatabaseName
    userAssignedIdentityResourceId: tenantIdentity.outputs.evalServiceIdentityId
  }
}

// 5. Per-tenant storage-proxy container app, reusing the shared module.
//    The module grants Blob Data Contributor on the shared storage account
//    to the tenant's storage-proxy UAMI.
module tenantStorageProxy 'modules/storage-proxy.bicep' = {
  name: 'deploy-tenant-storage-proxy-${tenantId}'
  params: {
    location: location
    containerAppName: storageProxyAppName
    containerAppEnvResourceId: sharedCae.id
    containerImage: storageProxyImage
    containerAppExists: storageProxyAppExists
    userAssignedIdentityResourceId: tenantIdentity.outputs.storageProxyIdentityId
    userAssignedIdentityClientId: tenantIdentity.outputs.storageProxyIdentityClientId
    userAssignedIdentityPrincipalId: tenantIdentity.outputs.storageProxyIdentityPrincipalId
    acrResourceId: acrResourceId
    manageAcrPullRoleAssignment: false
    storageAccountName: storageAccountName
    tags: tags
  }
}

// 6. Per-tenant eval-service container app. Talks to the shared Cosmos account
//    over the shared private endpoint, but writes to the per-tenant database.
module tenantEvalService 'modules/tenant-eval-service.bicep' = {
  name: 'deploy-tenant-eval-service-${tenantId}'
  params: {
    location: location
    containerAppName: evalServiceAppName
    containerAppEnvResourceId: sharedCae.id
    containerImage: evalServiceImage
    containerAppExists: evalServiceAppExists
    userAssignedIdentityResourceId: tenantIdentity.outputs.evalServiceIdentityId
    userAssignedIdentityClientId: tenantIdentity.outputs.evalServiceIdentityClientId
    acrResourceId: acrResourceId
    manageAcrPullRoleAssignment: false
    cosmosAccountName: cosmosAccountName
    cosmosDatabaseName: cosmosDatabaseName
    foundryProjectEndpoint: tenantProject.outputs.projectEndpoint
    foundryModelDeployment: foundryModelDeployment
    appInsightsConnectionString: tenantAppInsights.properties.ConnectionString
    pollerIntervalSeconds: evalPollerIntervalSeconds
    tenantId: tenantId
    tags: tags
  }
  dependsOn: [
    tenantCosmos
  ]
}

// 7. Per-tenant Static Web App (separate URL per deployment).
module tenantStaticWebApp 'modules/staticwebapp.bicep' = {
  name: 'deploy-tenant-swa-${tenantId}'
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

// ===========================================================================
// Outputs
// ===========================================================================

output tenantId string = tenantId

output tenantFoundryProjectName string = tenantProject.outputs.projectName
output tenantFoundryProjectEndpoint string = tenantProject.outputs.projectEndpoint

output tenantCosmosDatabaseName string = tenantCosmos.outputs.databaseName
output tenantCosmosEndpoint string = tenantCosmos.outputs.cosmosEndpoint

output tenantEvalServiceIdentityId string = tenantIdentity.outputs.evalServiceIdentityId
output tenantStorageProxyIdentityId string = tenantIdentity.outputs.storageProxyIdentityId

output tenantAppInsightsConnectionString string = tenantAppInsights.properties.ConnectionString
output tenantAppInsightsId string = tenantAppInsights.id

output tenantStorageProxyUrl string = tenantStorageProxy.outputs.storageProxyUrl
output tenantEvalServiceUrl string = tenantEvalService.outputs.evalServiceUrl

output tenantStaticWebAppUrl string = tenantStaticWebApp.outputs.staticWebAppUrl
output tenantStaticWebAppName string = tenantStaticWebApp.outputs.staticWebAppName
