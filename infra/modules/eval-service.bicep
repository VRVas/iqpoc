// Codifies the eval-service stack: Cosmos DB (Serverless, NoSQL, Entra-only),
// Private Endpoint into an existing VNet subnet, private DNS for
// privatelink.documents.azure.com, Cosmos NoSQL data plane RBAC for the UAMI,
// and the Container App that hosts the FastAPI eval-service.
//
// References (MS Learn):
//   Serverless NoSQL provisioning:
//     https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/quickstart-bicep
//   Disable local (key) auth:
//     https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/security/how-to-disable-key-based-authentication
//   Private endpoint for Cosmos NoSQL (groupId = "Sql"):
//     https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-configure-private-endpoints
//     https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns#cosmos-db
//   Cosmos NoSQL data plane role assignments:
//     https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/security/how-to-grant-data-plane-role-based-access
//   Container Apps + VNet integration:
//     https://learn.microsoft.com/en-us/azure/container-apps/networking
//     https://learn.microsoft.com/en-us/azure/container-apps/managed-identity?tabs=arm

@description('Azure region for the eval-service stack.')
param location string

@description('Resource ID of an existing virtual network used by the Container App environment.')
param vnetResourceId string

@description('Resource ID of the subnet that will host the Cosmos DB private endpoint. Network policies must be disabled on this subnet.')
param peSubnetResourceId string

@description('Resource ID of the existing user-assigned managed identity granted Cosmos DB data plane access.')
param userAssignedIdentityResourceId string

@description('clientId of the user-assigned managed identity — surfaced as AZURE_CLIENT_ID inside the container.')
param userAssignedIdentityClientId string

@description('Resource ID of an existing Container Apps managed environment with VNet injection.')
param containerAppEnvResourceId string

@description('Fully qualified image reference for the eval-service container, e.g. cronlgvc76rbuge.azurecr.io/eval-service/eval-service:v26.')
param containerImage string

@description('Resource ID of the Azure Container Registry that hosts the image. Used for managed-identity ACR pull RBAC.')
param acrResourceId string = ''

@description('Foundry project endpoint passed as FOUNDRY_PROJECT_ENDPOINT.')
param foundryProjectEndpoint string

@description('Model deployment used by default evaluations.')
param foundryModelDeployment string = 'gpt-4.1-mini'

@description('Application Insights connection string for OpenTelemetry export. Empty disables telemetry.')
@secure()
param appInsightsConnectionString string = ''

@description('Cosmos DB account name (3-44 lowercase chars + digits + dashes).')
param cosmosAccountName string = 'cosmos-eval-iqpoc'

@description('Cosmos database name.')
param cosmosDatabaseName string = 'eval-db'

@description('Container App name.')
param containerAppName string = 'ca-eval-svc-v2'

@description('Background poller interval in seconds (0 disables when EVAL_POLLER_DISABLED=1).')
param pollerIntervalSeconds int = 30

// Built-in Cosmos NoSQL data plane role: "Cosmos DB Built-In Data Contributor"
// Ref: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/security/reference-data-plane-roles#cosmos-db-built-in-data-contributor
var cosmosBuiltInDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

// AcrPull built-in role.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// ---------------------------------------------------------------------------
// Cosmos DB (Serverless, NoSQL, Entra-only)
// ---------------------------------------------------------------------------
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      { name: 'EnableServerless' }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true
    minimalTlsVersion: 'Tls12'
    networkAclBypass: 'None'
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
  }
}

resource evalResultsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'eval-results'
  properties: {
    resource: {
      id: 'eval-results'
      partitionKey: {
        paths: [ '/evalId' ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/"_etag"/?' } ]
      }
    }
  }
}

resource responseLogContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'response-log'
  properties: {
    resource: {
      id: 'response-log'
      partitionKey: {
        paths: [ '/agentName' ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/"_etag"/?' } ]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Private endpoint for Cosmos (subresource = "Sql"), private DNS, VNet link
// ---------------------------------------------------------------------------
resource cosmosPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-${cosmosAccountName}'
  location: location
  properties: {
    subnet: {
      id: peSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'cosmos-connection'
        properties: {
          privateLinkServiceId: cosmos.id
          groupIds: [ 'Sql' ]
        }
      }
    ]
  }
}

resource cosmosPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.documents.azure.com'
  location: 'global'
}

resource cosmosDnsVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: cosmosPrivateDnsZone
  name: '${last(split(vnetResourceId, '/'))}-cosmos-link'
  location: 'global'
  properties: {
    virtualNetwork: {
      id: vnetResourceId
    }
    registrationEnabled: false
  }
}

resource cosmosPeDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: cosmosPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'privatelink-documents-azure-com'
        properties: {
          privateDnsZoneId: cosmosPrivateDnsZone.id
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Cosmos NoSQL data plane RBAC: grant the UAMI data contributor access
// Per MS Learn this MUST be a sqlRoleAssignments resource (NOT Microsoft.Authorization).
// ---------------------------------------------------------------------------
resource uamiCosmosDataAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  // GUID derived from {accountId, principalId, roleId} for idempotency.
  name: guid(cosmos.id, userAssignedIdentityResourceId, cosmosBuiltInDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosBuiltInDataContributorRoleId}'
    principalId: reference(userAssignedIdentityResourceId, '2023-01-31', 'Full').properties.principalId
    scope: cosmos.id
  }
}

// ---------------------------------------------------------------------------
// AcrPull role for the UAMI on the registry (only if acrResourceId provided)
// ---------------------------------------------------------------------------
resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(acrResourceId)) {
  name: guid(acrResourceId, userAssignedIdentityResourceId, acrPullRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: reference(userAssignedIdentityResourceId, '2023-01-31', 'Full').properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Container App — FastAPI eval-service with UAMI for Cosmos + Foundry
// Public ingress, internal-only Cosmos via private endpoint.
// ---------------------------------------------------------------------------
resource evalServiceApp 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: containerAppName
  location: location
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
      registries: !empty(acrResourceId) ? [
        {
          server: '${split(last(split(acrResourceId, '/')), '.')[0]}.azurecr.io'
          identity: userAssignedIdentityResourceId
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'eval-service'
          image: containerImage
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
  dependsOn: [
    cosmosPeDnsZoneGroup
    uamiCosmosDataAssignment
  ]
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output cosmosAccountId string = cosmos.id
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output evalServiceFqdn string = evalServiceApp.properties.configuration.ingress.fqdn
output evalServiceUrl string = 'https://${evalServiceApp.properties.configuration.ingress.fqdn}'
