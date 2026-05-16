// Azure Container Registry provisioned in the same RG as the container apps.
// Used by azd for build + push of service images on `azd deploy`.
//
// Greenfield default: Basic SKU, admin user disabled, AAD/managed-identity pull only.
// The caller is expected to grant AcrPull to any UAMI that will pull from this
// ACR via the dedicated `acrPullAssignments` array.
//
// References:
//   https://learn.microsoft.com/azure/container-registry/container-registry-skus
//   https://learn.microsoft.com/azure/container-registry/container-registry-authentication-managed-identity

@description('ACR name. Must be globally unique, 5-50 alphanumeric chars (no dashes).')
@minLength(5)
@maxLength(50)
param acrName string

@description('Azure region.')
param location string

@description('SKU.')
@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param sku string = 'Basic'

@description('Tags.')
param tags object = {}

@description('Principal IDs (typically UAMIs) to grant AcrPull on this ACR.')
param acrPullPrincipalIds array = []

// Built-in AcrPull role.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
    anonymousPullEnabled: false
  }
}

resource acrPullAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in acrPullPrincipalIds: {
  name: guid(registry.id, principalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}]

output acrId string = registry.id
output acrName string = registry.name
output loginServer string = registry.properties.loginServer
