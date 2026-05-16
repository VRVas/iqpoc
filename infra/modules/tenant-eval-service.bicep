// Per-tenant slice of the eval-service: ONLY the Container App. Cosmos DB,
// private endpoint, DNS zone group, and Cosmos data-plane RBAC are NOT
// provisioned here — they are either shared (Cosmos account, PE, DNS) or live
// in the per-tenant cosmos-database module (eval-db-<tenant> + RBAC).
//
// Use this from per-tenant bicep templates so multiple tenants can run their
// own eval-service container apps against the same shared Cosmos account and
// the same VNet-injected Container Apps environment.
//
// References (MS Learn):
//   Container Apps + managed identity:
//     https://learn.microsoft.com/en-us/azure/container-apps/managed-identity?tabs=arm

@description('Azure region.')
param location string

@description('Container App name (e.g. ca-eval-svc-zava).')
param containerAppName string

@description('Resource ID of an existing Container Apps managed environment with VNet injection.')
param containerAppEnvResourceId string

@description('Fully qualified image reference for the eval-service container.')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('When true, the module reads the live container app image and preserves it across redeploys (azd-style image preservation).')
param containerAppExists bool = false

@description('Resource ID of the UAMI granted Cosmos + Foundry access.')
param userAssignedIdentityResourceId string

@description('clientId of the UAMI — surfaced as AZURE_CLIENT_ID.')
param userAssignedIdentityClientId string

@description('Resource ID of the ACR hosting the image. Used for managed-identity ACR pull RBAC.')
param acrResourceId string = ''

@description('Optional explicit ACR login server. When empty, derived from acrResourceId.')
param acrLoginServer string = ''

@description('When true, create an AcrPull role assignment scoped to the current RG. Leave false when the ACR lives in another RG/subscription and RBAC is granted out-of-band on the ACR itself.')
param manageAcrPullRoleAssignment bool = false

@description('Cosmos account name (resolved server-side to derive COSMOS_ENDPOINT).')
param cosmosAccountName string

@description('Cosmos database name for THIS tenant (e.g. eval-db-zava).')
param cosmosDatabaseName string

@description('Foundry project endpoint (e.g. https://<account>.services.ai.azure.com/api/projects/<project>).')
param foundryProjectEndpoint string

@description('Default model deployment used by the eval-service.')
param foundryModelDeployment string = 'gpt-4.1-mini'

@description('Application Insights connection string for OpenTelemetry export. Empty disables telemetry.')
@secure()
param appInsightsConnectionString string = ''

@description('Background poller interval in seconds.')
param pollerIntervalSeconds int = 30

@description('Tenant id (e.g. "qatar", "zava") surfaced as the TENANT_ID env var so the FastAPI service can gate tenant-specific evaluators.')
param tenantId string

@description('Tag map applied to the container app.')
param tags object = {}

// AcrPull built-in role.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = {
  name: cosmosAccountName
}

// AcrPull (optional — typically granted directly on the ACR resource in a sibling RG).
resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageAcrPullRoleAssignment && !empty(acrResourceId)) {
  name: guid(acrResourceId, userAssignedIdentityResourceId, acrPullRoleId, containerAppName)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: reference(userAssignedIdentityResourceId, '2023-01-31', 'Full').properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Image preservation across azd provision/deploy cycles.
resource existingEvalServiceApp 'Microsoft.App/containerApps@2024-10-02-preview' existing = if (containerAppExists) {
  name: containerAppName
}

var evalLiveImage = containerAppExists ? (existingEvalServiceApp.?properties.?template.?containers[0].?image ?? '') : ''
var evalEffectiveImage = !empty(evalLiveImage) ? evalLiveImage : containerImage
var evalEffectiveLoginServer = !empty(acrLoginServer)
  ? acrLoginServer
  : (!empty(acrResourceId) ? '${split(last(split(acrResourceId, '/')), '.')[0]}.azurecr.io' : '')

resource evalServiceApp 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: containerAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppEnvResourceId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
      }
      registries: !empty(evalEffectiveLoginServer) ? [
        {
          server: evalEffectiveLoginServer
          identity: userAssignedIdentityResourceId
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'eval-service'
          image: evalEffectiveImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
            { name: 'COSMOS_CONTAINER_EVAL_RESULTS', value: 'eval-results' }
            { name: 'COSMOS_CONTAINER_RESPONSE_LOG', value: 'response-log' }
            { name: 'AZURE_CLIENT_ID', value: userAssignedIdentityClientId }
            { name: 'FOUNDRY_PROJECT_ENDPOINT', value: foundryProjectEndpoint }
            { name: 'FOUNDRY_MODEL_DEPLOYMENT', value: foundryModelDeployment }
            { name: 'EVAL_POLLER_INTERVAL', value: string(pollerIntervalSeconds) }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
            { name: 'TENANT_ID', value: tenantId }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 8000 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 8000 }
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output evalServiceFqdn string = evalServiceApp.properties.configuration.ingress.fqdn
output evalServiceUrl string = 'https://${evalServiceApp.properties.configuration.ingress.fqdn}'
