using './main-zava.bicep'

// Tenant identity. Drives resource naming + the TENANT_ID env var on the eval-service.
param tenantId = 'zava'

// Optional overrides — uncomment to pin specific resource names rather than the defaults.
// param foundryProjectName = 'proj-zava'
// param cosmosDatabaseName = 'eval-db-zava'
// param evalServiceIdentityName = 'id-eval-service-zava'
// param storageProxyIdentityName = 'id-storage-proxy-zava'
// param evalServiceAppName = 'ca-eval-svc-zava'
// param storageProxyAppName = 'ca-storage-proxy-zava'
// param appInsightsName = 'appi-eval-zava'

// SWA wiring — leave repositoryUrl/repositoryToken empty for azd-deploy mode.
// param swaRepositoryUrl = 'https://github.com/VRVas/iqpoc'
// param swaBranch = 'main'
// param swaRepositoryToken = readEnvironmentVariable('AZURE_SWA_GITHUB_TOKEN', '')
