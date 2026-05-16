// Private endpoint + private DNS zone group that connects an existing storage
// account's blob subresource into the VNet's PE subnet.
//
// References (MS Learn):
//   https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints
//   https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns#storage

@description('Azure region for the private endpoint.')
param location string

@description('Name of the existing storage account.')
param storageAccountName string

@description('Resource ID of the subnet that hosts the private endpoint (privateEndpointNetworkPolicies must be Disabled).')
param peSubnetResourceId string

@description('Resource ID of the privatelink.blob.<storageSuffix> DNS zone, vnet-linked already.')
param blobDnsZoneId string

@description('Private endpoint name.')
param privateEndpointName string = 'pe-blob-iqpoc'

@description('Tag map applied to the private endpoint.')
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: storageAccountName
}

resource blobPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: privateEndpointName
  location: location
  tags: tags
  properties: {
    subnet: {
      id: peSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'blob-conn'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: [ 'blob' ]
        }
      }
    ]
  }
}

resource blobPeDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: blobPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'privatelink-blob'
        properties: {
          privateDnsZoneId: blobDnsZoneId
        }
      }
    ]
  }
}

output privateEndpointId string = blobPrivateEndpoint.id
output privateEndpointName string = blobPrivateEndpoint.name
