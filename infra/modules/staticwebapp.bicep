// Azure Static Web App for Next.js hosting.
//
// Two supported provisioning modes:
//   1. GitHub-wired (legacy iqpoc): pass `repositoryUrl` + `repositoryToken`;
//      GitHub Actions will build & deploy from the named branch.
//   2. azd-deployed (greenfield): leave `repositoryUrl` empty; `azd deploy web`
//      will push the build artifacts to the SWA using the deployment token.
//
// Build properties are only attached when GitHub wiring is enabled.

@description('Name of the static web app')
param staticWebAppName string

@description('Location for the static web app')
param location string = resourceGroup().location

@description('SKU for the static web app')
@allowed([
  'Standard'
])
param sku string = 'Standard'

@description('Tags for the static web app')
param tags object = {}

@description('Repository URL. Leave empty to skip GitHub provider wiring (azd deploy mode).')
param repositoryUrl string = ''

@description('Branch name (only used when repositoryUrl is set).')
param branch string = 'main'

@description('Repository token. Leave empty to skip GitHub provider wiring.')
@secure()
param repositoryToken string = ''

@description('Build properties (only used when repositoryUrl is set).')
param buildProperties object = {
  appLocation: '/'
  apiLocation: ''
  outputLocation: '.next'
  appBuildCommand: 'npm run build'
  apiBuildCommand: ''
}

var useGitHubProvider = !empty(repositoryUrl) && !empty(repositoryToken)

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: sku
    tier: sku
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: useGitHubProvider ? {
    repositoryUrl: repositoryUrl
    branch: branch
    repositoryToken: repositoryToken
    buildProperties: buildProperties
    provider: 'GitHub'
    publicNetworkAccess: 'Enabled'
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
    enterpriseGradeCdnStatus: 'Disabled'
  } : {
    publicNetworkAccess: 'Enabled'
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
    enterpriseGradeCdnStatus: 'Disabled'
  }
}

// Output Static Web App details
output staticWebAppId string = staticWebApp.id
output staticWebAppName string = staticWebApp.name
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output defaultHostname string = staticWebApp.properties.defaultHostname
output staticWebAppPrincipalId string = staticWebApp.identity.principalId
