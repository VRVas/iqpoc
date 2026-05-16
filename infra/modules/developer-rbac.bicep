// Developer RBAC — grants the human user (or service principal) running
// `azd up` enough data-plane access to interact with the demo resources
// from their workstation immediately after provisioning.
//
// Granted roles:
//   - Storage Blob Data Contributor on the storage account
//   - Search Index Data Contributor on the AI Search service
//   - Cognitive Services User on the Foundry / AIServices account
//   - AcrPush on the in-RG container registry
//
// All assignments use deterministic GUIDs so re-runs are idempotent. The
// module is a no-op when `principalId` is empty (e.g. CI without a known
// user object id).
//
// References:
//   https://learn.microsoft.com/azure/role-based-access-control/built-in-roles

@description('Object ID of the user or service principal receiving the demo roles. Empty disables all assignments.')
param principalId string = ''

@description('Principal type. Use "User" for human OID, "ServicePrincipal" for app/SP/managed identity.')
@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param principalType string = 'User'

@description('Storage account name to grant Storage Blob Data Contributor on.')
param storageAccountName string

@description('AI Search service name to grant Search Index Data Contributor on.')
param searchServiceName string

@description('AIServices account name to grant Cognitive Services User on.')
param aiServicesAccountName string

@description('Container registry name to grant AcrPush on.')
param acrName string

// Built-in roles (https://learn.microsoft.com/azure/role-based-access-control/built-in-roles)
var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var searchIndexDataContributorRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var acrPushRoleId = '8311e382-0749-4cb8-b61a-304f252e45ec'

var assignmentsEnabled = !empty(principalId)

resource storageAccount 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: storageAccountName
}

resource searchService 'Microsoft.Search/searchServices@2024-06-01-preview' existing = {
  name: searchServiceName
}

resource aiServicesAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: aiServicesAccountName
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
}

resource storageBlobAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignmentsEnabled) {
  name: guid(storageAccount.id, principalId, blobDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
    principalId: principalId
    principalType: principalType
  }
}

resource searchAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignmentsEnabled) {
  name: guid(searchService.id, principalId, searchIndexDataContributorRoleId)
  scope: searchService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchIndexDataContributorRoleId)
    principalId: principalId
    principalType: principalType
  }
}

resource cogServicesAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignmentsEnabled) {
  name: guid(aiServicesAccount.id, principalId, cognitiveServicesUserRoleId)
  scope: aiServicesAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: principalId
    principalType: principalType
  }
}

resource acrPushAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignmentsEnabled) {
  name: guid(acr.id, principalId, acrPushRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPushRoleId)
    principalId: principalId
    principalType: principalType
  }
}
