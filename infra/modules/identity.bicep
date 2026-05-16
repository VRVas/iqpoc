// User-assigned managed identities consumed by container apps.
//
// Reference (MS Learn):
//   https://learn.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/how-manage-user-assigned-managed-identities

@description('Azure region.')
param location string

@description('Name of the UAMI used by the eval-service container app for Cosmos DB + Foundry access.')
param evalServiceIdentityName string = 'id-eval-service'

@description('Name of the UAMI used by the storage-proxy container app for Storage Blob data plane access.')
param storageProxyIdentityName string = 'id-storage-proxy'

@description('Tag map applied to both identities.')
param tags object = {}

resource evalServiceIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: evalServiceIdentityName
  location: location
  tags: tags
}

resource storageProxyIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: storageProxyIdentityName
  location: location
  tags: tags
}

output evalServiceIdentityId string = evalServiceIdentity.id
output evalServiceIdentityClientId string = evalServiceIdentity.properties.clientId
output evalServiceIdentityPrincipalId string = evalServiceIdentity.properties.principalId

output storageProxyIdentityId string = storageProxyIdentity.id
output storageProxyIdentityClientId string = storageProxyIdentity.properties.clientId
output storageProxyIdentityPrincipalId string = storageProxyIdentity.properties.principalId
