// `ca-storage-proxy`: a small Node container that proxies authenticated
// requests to the private storage account using its UAMI. The container app
// runs in the VNet-injected environment so it can reach the storage blob
// service over the private endpoint without exposing keys.
//
// Includes the Storage Blob Data Contributor role assignment for the UAMI.
//
// References (MS Learn):
//   https://learn.microsoft.com/en-us/azure/container-apps/managed-identity?tabs=arm
//   https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-managed-identity

@description('Azure region.')
param location string

@description('Container app name.')
param containerAppName string = 'ca-storage-proxy'

@description('Resource ID of the VNet-injected Container Apps managed environment.')
param containerAppEnvResourceId string

@description('Fully qualified image reference, e.g. cronlgvc76rbuge.azurecr.io/storage-proxy:v2.')
param containerImage string

@description('Resource ID of the storage-proxy UAMI.')
param userAssignedIdentityResourceId string

@description('clientId of the UAMI — surfaced as AZURE_CLIENT_ID.')
param userAssignedIdentityClientId string

@description('principalId of the UAMI — used for Storage role assignment.')
param userAssignedIdentityPrincipalId string

@description('Resource ID of the Azure Container Registry hosting the image. Used for managed-identity ACR pull.')
param acrResourceId string = ''

@description('Name of the storage account the proxy talks to. Surfaced as AZURE_STORAGE_ACCOUNT_NAME.')
param storageAccountName string

@description('Ingress target port.')
param targetPort int = 3000

@description('Container CPU.')
param cpu string = '0.5'

@description('Container memory.')
param memory string = '1Gi'

@description('Minimum replicas.')
param minReplicas int = 1

@description('Maximum replicas.')
param maxReplicas int = 3

@description('Tag map applied to the container app.')
param tags object = {}

@description('When true, this module creates an AcrPull role assignment scoped to the current RG. Leave false when the ACR lives in a different RG/subscription and RBAC is granted out-of-band on the ACR scope. Live deployment grants AcrPull directly on the ACR resource in rg-hiacoo-mcp-private.')
param manageAcrPullRoleAssignment bool = false

// Built-in roles.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource storageAccount 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: storageAccountName
}

resource blobDataAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, userAssignedIdentityResourceId, blobDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
    principalId: userAssignedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageAcrPullRoleAssignment && !empty(acrResourceId)) {
  name: guid(acrResourceId, userAssignedIdentityResourceId, acrPullRoleId, containerAppName)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: userAssignedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource storageProxy 'Microsoft.App/containerApps@2024-10-02-preview' = {
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
        targetPort: targetPort
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
          name: 'storage-proxy'
          image: containerImage
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: [
            { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storageAccountName }
            { name: 'AZURE_CLIENT_ID', value: userAssignedIdentityClientId }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
  dependsOn: [
    blobDataAssignment
  ]
}

output storageProxyId string = storageProxy.id
output storageProxyFqdn string = storageProxy.properties.configuration.ingress.fqdn
output storageProxyUrl string = 'https://${storageProxy.properties.configuration.ingress.fqdn}'
