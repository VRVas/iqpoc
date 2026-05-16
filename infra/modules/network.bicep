// Network foundation: VNet with two subnets (Container Apps + Private Endpoints),
// NSGs for each subnet, and the Private DNS zones used by Storage Blob and
// Cosmos DB private endpoints (vnet-linked).
//
// References (MS Learn):
//   VNet integration for Container Apps:
//     https://learn.microsoft.com/en-us/azure/container-apps/networking
//   Subnet delegation for Microsoft.App/environments:
//     https://learn.microsoft.com/en-us/azure/container-apps/networking#subnet
//   Private Endpoint DNS:
//     https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns
//   NSG defaults are sufficient for outbound + intra-vnet traffic; private
//   endpoints bypass NSGs unless explicitly enforced via the subnet flag
//   `privateEndpointNetworkPolicies`.

@description('Azure region for VNet, subnets, and NSGs (DNS zones are global).')
param location string

@description('Virtual network name.')
param vnetName string = 'vnet-iqpoc'

@description('VNet address space (CIDR list).')
param addressPrefixes array = [ '10.1.0.0/16' ]

@description('Subnet name for Container Apps environment (delegated to Microsoft.App/environments).')
param caeSubnetName string = 'subnet-cae'

@description('CIDR for the Container Apps subnet. Microsoft.App/environments requires /23 or larger.')
param caeSubnetPrefix string = '10.1.0.0/23'

@description('Subnet name for Private Endpoints.')
param peSubnetName string = 'subnet-pe'

@description('CIDR for the Private Endpoint subnet.')
param peSubnetPrefix string = '10.1.2.0/24'

@description('Tag map applied to every regional resource (DNS zones are global and tagged separately).')
param tags object = {}

resource caeNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${vnetName}-${caeSubnetName}-nsg-${location}'
  location: location
  tags: tags
  properties: {
    securityRules: []
  }
}

resource peNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${vnetName}-${peSubnetName}-nsg-${location}'
  location: location
  tags: tags
  properties: {
    securityRules: []
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: addressPrefixes
    }
    subnets: [
      {
        name: caeSubnetName
        properties: {
          addressPrefix: caeSubnetPrefix
          networkSecurityGroup: {
            id: caeNsg.id
          }
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: peSubnetName
        properties: {
          addressPrefix: peSubnetPrefix
          networkSecurityGroup: {
            id: peNsg.id
          }
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource cosmosDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.documents.azure.com'
  location: 'global'
  tags: tags
}

resource cosmosDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: cosmosDnsZone
  name: '${vnetName}-cosmos-link'
  location: 'global'
  tags: tags
  properties: {
    virtualNetwork: {
      id: vnet.id
    }
    registrationEnabled: false
  }
}

resource blobDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}

resource blobDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: blobDnsZone
  name: 'link-${vnetName}'
  location: 'global'
  tags: tags
  properties: {
    virtualNetwork: {
      id: vnet.id
    }
    registrationEnabled: false
  }
}

output vnetId string = vnet.id
output vnetName string = vnet.name
output caeSubnetId string = '${vnet.id}/subnets/${caeSubnetName}'
output peSubnetId string = '${vnet.id}/subnets/${peSubnetName}'
output caeNsgId string = caeNsg.id
output peNsgId string = peNsg.id
output cosmosDnsZoneId string = cosmosDnsZone.id
output blobDnsZoneId string = blobDnsZone.id
