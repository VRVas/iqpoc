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

@description('Name of the Log Analytics workspace receiving stdout/stderr logs. The module reads its customerId and sharedKey via `existing` + `listKeys()` so callers do not have to plumb secrets.')
param logAnalyticsWorkspaceName string = ''

@description('Customer ID (workspaceId) of the Log Analytics workspace. Only required when `logAnalyticsWorkspaceName` is empty.')
param logAnalyticsCustomerId string = ''

@description('Shared key for the Log Analytics workspace. Only required when `logAnalyticsWorkspaceName` is empty. Marked secure even though it is a workspace shared key.')
@secure()
param logAnalyticsSharedKey string = ''

@description('Set true to make the VNet-injected environment internal-only (ingress private). The current deployment is external.')
param vnetEnvInternal bool = false

@description('When true (default), also deploy the legacy consumption-only CAE. Set false for greenfield (azd up) deployments that do not need the iqpoc-era legacy environment.')
param deployLegacyEnv bool = true

@description('Tag map applied to both environments.')
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = if (!empty(logAnalyticsWorkspaceName)) {
  name: logAnalyticsWorkspaceName
}

var effectiveCustomerId = !empty(logAnalyticsWorkspaceName) ? (workspace.?properties.?customerId ?? '') : logAnalyticsCustomerId
var effectiveSharedKey = !empty(logAnalyticsWorkspaceName)
  ? listKeys(resourceId('Microsoft.OperationalInsights/workspaces', logAnalyticsWorkspaceName), '2022-10-01').primarySharedKey
  : logAnalyticsSharedKey

resource legacyEnv 'Microsoft.App/managedEnvironments@2024-10-02-preview' = if (deployLegacyEnv) {
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
        customerId: effectiveCustomerId
        sharedKey: effectiveSharedKey
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
        customerId: effectiveCustomerId
        sharedKey: effectiveSharedKey
      }
    }
  }
}

output legacyEnvId string = deployLegacyEnv ? legacyEnv.id : ''
output legacyEnvName string = deployLegacyEnv ? legacyEnv.name : ''
output vnetEnvId string = vnetEnv.id
output vnetEnvName string = vnetEnv.name
output vnetEnvDefaultDomain string = vnetEnv.properties.defaultDomain
