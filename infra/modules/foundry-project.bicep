// Provision a single Foundry project as a child of an existing AI Services
// (kind=AIServices) account. Use this from per-tenant bicep templates so each
// tenant gets its own project (Ring 1 of the Zava/Qatar data-isolation model)
// while sharing the same Cognitive Services account.
//
// References (MS Learn):
//   Foundry project resource type:
//     https://learn.microsoft.com/en-us/azure/templates/microsoft.cognitiveservices/accounts/projects
//   Foundry IQ multi-project pattern:
//     https://learn.microsoft.com/en-us/azure/ai-services/agents/quickstart

@description('Azure region for the project (must match the parent account).')
param location string

@description('Name of the EXISTING parent AI Services account.')
param accountName string

@description('Name of the project to create.')
param projectName string

@description('Friendly display name shown in the Foundry portal.')
param projectDisplayName string = projectName

@description('Free-form project description.')
param projectDescription string = ''

@description('Tag map applied to the project.')
param tags object = {}

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: accountName
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

output projectId string = project.id
output projectName string = project.name
output projectPrincipalId string = project.identity.principalId
output projectEndpoint string = 'https://${accountName}.services.ai.azure.com/api/projects/${projectName}'
