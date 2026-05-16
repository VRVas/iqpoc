// Foundry / Cognitive Services AI Services account with model deployments
// and a project (the modern Foundry experience — kind=AIServices).
//
// References (MS Learn):
//   AI Services account:
//     https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource
//   Model deployment via Bicep:
//     https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/create-resource
//   Foundry project (account/projects child):
//     https://learn.microsoft.com/en-us/azure/ai-services/agents/quickstart
//
// Note: model deployments are deployed sequentially via `@batchSize(1)` because
// the Cognitive Services control plane does not allow multiple concurrent
// PUTs against the same account.

@description('Azure region.')
param location string

@description('Name of the AI Services account (becomes the customSubDomain).')
param accountName string

@description('SKU name (S0 is the only currently supported SKU for AIServices).')
param sku string = 'S0'

@description('Public network access. Leave Enabled for Foundry portal compatibility; restrict via PE in a separate module if required.')
@allowed([
  'Enabled'
  'Disabled'
])
param publicNetworkAccess string = 'Enabled'

@description('Foundry project name (child of the account).')
param projectName string = 'proj-iqpoc'

@description('Friendly display name for the project.')
param projectDisplayName string = 'iqpoc'

@description('Project description.')
param projectDescription string = 'Foundry IQ demo project.'

@description('List of model deployments to create. Each entry specifies (name, model, version, sku, capacity). Order is preserved.')
param modelDeployments array = []

@description('Tag map applied to the account, project, and deployments.')
param tags object = {}

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: sku
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: accountName
    publicNetworkAccess: publicNetworkAccess
    disableLocalAuth: false
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2024-10-01' = {
  parent: account
  name: projectName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: projectDisplayName
    description: projectDescription
  }
}

@batchSize(1)
resource deployments 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = [for d in modelDeployments: {
  parent: account
  name: d.name
  sku: {
    name: d.sku
    capacity: d.capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: d.model
      version: d.version
    }
  }
}]

output accountId string = account.id
output accountName string = account.name
output accountEndpoint string = account.properties.endpoint
output accountPrincipalId string = account.identity.principalId
output projectId string = project.id
output projectName string = project.name
output projectEndpoint string = '${account.properties.endpoint}api/projects/${project.name}'
