// Container Apps Managed Environments.
//
// Two environments are deployed to mirror the iqpoc footprint:
//   1. `cae-eval-iqpoc`        — legacy, consumption only, no VNet.
//                                Kept to preserve existing `ca-eval-service`
//                                until it is decommissioned.
//   2. `cae-storage-proxy`     — VNet-injected via the dedicated CAE subnet.
//                                Hosts `ca-storage-proxy` and `ca-eval-svc-v2`.
//
// References (MS Learn):
//   Managed environments:
//     https://learn.microsoft.com/en-us/azure/container-apps/environment
//   VNet integration & subnet sizing:
//     https://learn.microsoft.com/en-us/azure/container-apps/networking

@description('Azure region.')
param location string

@description('Name of the legacy (non-VNet) environment.')
param legacyEnvName string = 'cae-eval-iqpoc'

@description('Name of the VNet-injected environment that hosts the storage-proxy and eval-service-v2.')
param vnetEnvName string = 'cae-storage-proxy'

@description('Resource ID of the subnet delegated to Microsoft.App/environments (used by the VNet env only).')
param caeSubnetId string

@description('Customer ID (workspaceId) of the Log Analytics workspace receiving stdout/stderr logs.')
param logAnalyticsCustomerId string

@description('Shared key for the Log Analytics workspace. Marked secure even though it is a workspace shared key.')
@secure()
param logAnalyticsSharedKey string

@description('Set true to make the VNet-injected environment internal-only (ingress private). The current deployment is external.')
param vnetEnvInternal bool = false

@description('Tag map applied to both environments.')
param tags object = {}

resource legacyEnv 'Microsoft.App/managedEnvironments@2024-10-02-preview' = {
  name: legacyEnvName
  location: location
  tags: tags
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

resource vnetEnv 'Microsoft.App/managedEnvironments@2024-10-02-preview' = {
  name: vnetEnvName
  location: location
  tags: tags
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    vnetConfiguration: {
      infrastructureSubnetId: caeSubnetId
      internal: vnetEnvInternal
    }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

output legacyEnvId string = legacyEnv.id
output legacyEnvName string = legacyEnv.name
output vnetEnvId string = vnetEnv.id
output vnetEnvName string = vnetEnv.name
output vnetEnvDefaultDomain string = vnetEnv.properties.defaultDomain
