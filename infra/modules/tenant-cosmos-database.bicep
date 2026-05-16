// Adds a per-tenant database (eval-results + response-log containers) inside
// an EXISTING shared Cosmos DB account, and grants a UAMI Cosmos NoSQL data
// plane access scoped to that database. This is Ring 3 of the Zava/Qatar
// data-isolation model: shared account, per-tenant database namespace.
//
// References (MS Learn):
//   Cosmos NoSQL SQL databases via Bicep:
//     https://learn.microsoft.com/en-us/azure/templates/microsoft.documentdb/databaseaccounts/sqldatabases
//   Cosmos NoSQL data plane role assignments (must use sqlRoleAssignments,
//   NOT Microsoft.Authorization):
//     https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/security/how-to-grant-data-plane-role-based-access

@description('Name of the EXISTING shared Cosmos DB account.')
param cosmosAccountName string

@description('Name of the per-tenant database to create.')
param databaseName string

@description('Resource ID of the UAMI that should receive Cosmos data plane access.')
param userAssignedIdentityResourceId string

// Built-in Cosmos NoSQL data plane role: "Cosmos DB Built-In Data Contributor"
// Ref: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/security/reference-data-plane-roles#cosmos-db-built-in-data-contributor
var cosmosBuiltInDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = {
  name: cosmosAccountName
}

resource db 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource evalResultsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: db
  name: 'eval-results'
  properties: {
    resource: {
      id: 'eval-results'
      partitionKey: {
        paths: [ '/evalId' ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/"_etag"/?' } ]
      }
    }
  }
}

resource responseLogContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: db
  name: 'response-log'
  properties: {
    resource: {
      id: 'response-log'
      partitionKey: {
        paths: [ '/agentName' ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/"_etag"/?' } ]
      }
    }
  }
}

// Scope the data-plane role assignment to the database (not the whole account)
// so the tenant UAMI can only read/write its own database. The role definition
// itself lives at the account level (built-in role 0000...0002).
resource uamiCosmosDataAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, db.id, userAssignedIdentityResourceId, cosmosBuiltInDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosBuiltInDataContributorRoleId}'
    principalId: reference(userAssignedIdentityResourceId, '2023-01-31', 'Full').properties.principalId
    scope: db.id
  }
}

output databaseName string = db.name
output databaseId string = db.id
output cosmosEndpoint string = cosmos.properties.documentEndpoint
