// Observability stack: Log Analytics workspace, Application Insights
// (workspace-based), and a multi-location Standard Ping availability test
// against the warmup endpoint of the public Static Web App.
//
// References (MS Learn):
//   Workspace-based App Insights (required since Feb 2024):
//     https://learn.microsoft.com/en-us/azure/azure-monitor/app/create-workspace-resource
//   Standard ping availability test (classic webtests):
//     https://learn.microsoft.com/en-us/azure/azure-monitor/app/availability-overview

@description('Azure region.')
param location string

@description('Log Analytics workspace name.')
param logAnalyticsName string = 'log-eval-iqpoc'

@description('Application Insights resource name.')
param appInsightsName string = 'appi-eval-iqpoc'

@description('Web test name (must match the resource name displayed in the App Insights → Availability blade).')
param webTestName string = 'warmup-aikb-web'

@description('Public URL that the availability test polls every 5 min. Should return 200 with body containing the matchText.')
param webTestUrl string

@description('String that must be present in the response body for the test to pass.')
param webTestMatchText string = 'total_ms'

@description('Azure Monitor probe locations. Defaults to 5 geographically diverse points.')
param webTestLocations array = [
  'us-il-ch1-azr'
  'us-ca-sjc-azr'
  'us-tx-sn1-azr'
  'emea-nl-ams-azr'
  'apac-sg-sin-azr'
]

@description('Test frequency in seconds (300 = every 5 minutes).')
param webTestFrequency int = 300

@description('Per-location timeout in seconds.')
param webTestTimeout int = 30

@description('Daily ingestion cap (GB). 0 disables the cap.')
param dailyCapGb int = 0

@description('Workspace SKU.')
param workspaceSku string = 'PerGB2018'

@description('Tag map applied to all resources.')
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: workspaceSku
    }
    retentionInDays: 30
    workspaceCapping: dailyCapGb == 0 ? null : {
      dailyQuotaGb: dailyCapGb
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// The hidden-link tag pattern lets the Azure portal Availability blade show
// this webtest under the App Insights resource.
resource webTest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: webTestName
  location: location
  tags: union(tags, {
    'hidden-link:${appInsights.id}': 'Resource'
  })
  kind: 'ping'
  properties: {
    SyntheticMonitorId: webTestName
    Name: webTestName
    Description: 'Keeps the SWA Functions instance + Foundry token cache warm.'
    Enabled: true
    Frequency: webTestFrequency
    Timeout: webTestTimeout
    Kind: 'ping'
    RetryEnabled: true
    Locations: [for loc in webTestLocations: {
      Id: loc
    }]
    Configuration: {
      WebTest: '<WebTest Name="${webTestName}" Enabled="True" Timeout="${webTestTimeout}" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"><Items><Request Method="GET" Version="1.1" Url="${webTestUrl}" ThinkTime="0" Timeout="${webTestTimeout}" ParseDependentRequests="False" FollowRedirects="True" RecordResult="True" Cache="False" ResponseTimeGoal="0" Encoding="utf-8" ExpectedHttpStatusCode="200" ExpectedResponseUrl="" ReportingName="" IgnoreHttpStatusCode="False" /></Items></WebTest>'
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      IgnoreHttpStatusCode: false
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
      ContentValidation: {
        ContentMatch: webTestMatchText
        IgnoreCase: true
        PassIfTextFound: true
      }
    }
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
output workspaceCustomerId string = workspace.properties.customerId
output appInsightsId string = appInsights.id
output appInsightsName string = appInsights.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
output webTestId string = webTest.id
