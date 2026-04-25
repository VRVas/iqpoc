import { ClientSecretCredential, DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity'

class TokenManager {
  private static instance: TokenManager
  private credential: ClientSecretCredential | DefaultAzureCredential | ManagedIdentityCredential | null = null
  private cachedToken: { token: string; expiresOn: Date } | null = null
  private cachedArmToken: { token: string; expiresOn: Date } | null = null
  private readonly scope = 'https://ai.azure.com/.default'
  private readonly armScope = 'https://management.azure.com/.default'

  private constructor() {
    this.initializeCredential()
  }

  private initializeCredential() {
    const authMethod = process.env.AZURE_AUTH_METHOD || 'service-principal'

    try {
      switch (authMethod) {
        case 'service-principal':
          // Use service principal for local development and deployment
          const tenantId = process.env.AZURE_TENANT_ID
          const clientId = process.env.AZURE_CLIENT_ID
          const clientSecret = process.env.AZURE_CLIENT_SECRET

          if (!tenantId || !clientId || !clientSecret) {
            console.warn('Service principal credentials not found, falling back to DefaultAzureCredential')
            this.credential = new DefaultAzureCredential()
          } else {
            console.log('Using Service Principal authentication')
            this.credential = new ClientSecretCredential(tenantId, clientId, clientSecret)
          }
          break

        case 'managed-identity':
          // Use managed identity for Azure deployment
          console.log('Using Managed Identity authentication')
          const managedIdentityClientId = process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID
          this.credential = managedIdentityClientId
            ? new ManagedIdentityCredential(managedIdentityClientId)
            : new ManagedIdentityCredential()
          break

        default:
          // Use DefaultAzureCredential which tries multiple auth methods
          console.log('Using Default Azure Credential (tries multiple methods)')
          this.credential = new DefaultAzureCredential()
      }
    } catch (error) {
      console.error('Failed to initialize credential:', error)
      // Fall back to DefaultAzureCredential as last resort
      this.credential = new DefaultAzureCredential()
    }
  }

  public static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager()
    }
    return TokenManager.instance
  }

  public async getToken(): Promise<string> {
    // Check if we have a cached token that's still valid
    if (this.cachedToken) {
      const now = new Date()
      const expiresOn = new Date(this.cachedToken.expiresOn)

      // Refresh token if it expires in less than 5 minutes
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000)

      if (expiresOn > fiveMinutesFromNow) {
        console.log('Using cached token')
        return this.cachedToken.token
      }
    }

    // Get a fresh token
    try {
      if (!this.credential) {
        throw new Error('Azure credential not initialized')
      }

      console.log('Fetching new token from Azure AD...')
      const tokenResponse = await this.credential.getToken(this.scope)

      if (!tokenResponse) {
        throw new Error('Failed to get token from Azure AD')
      }

      // Cache the token
      this.cachedToken = {
        token: tokenResponse.token,
        expiresOn: tokenResponse.expiresOnTimestamp
          ? new Date(tokenResponse.expiresOnTimestamp)
          : new Date(Date.now() + 60 * 60 * 1000) // Default to 1 hour if not provided
      }

      console.log(`Token refreshed, expires at ${this.cachedToken.expiresOn.toISOString()}`)
      return this.cachedToken.token
    } catch (error) {
      console.error('Failed to get Azure AD token:', error)

      // If we still have a cached token (even if expired), return it as fallback
      if (this.cachedToken) {
        console.warn('Using expired cached token as fallback')
        return this.cachedToken.token
      }

      throw new Error(`Failed to get Azure AD token: ${error.message}`)
    }
  }

  // Force refresh the token
  public async refreshToken(): Promise<string> {
    this.cachedToken = null
    return this.getToken()
  }

  // Check if token needs refresh
  public needsRefresh(): boolean {
    if (!this.cachedToken) return true

    const now = new Date()
    const expiresOn = new Date(this.cachedToken.expiresOn)
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000)

    return expiresOn <= fiveMinutesFromNow
  }

  /**
   * Get an ARM management plane token (scope: https://management.azure.com/.default).
   * Used for Azure Resource Manager operations like creating project connections.
   */
  public async getArmToken(): Promise<string> {
    // Check if we have a cached ARM token that's still valid
    if (this.cachedArmToken) {
      const now = new Date()
      const expiresOn = new Date(this.cachedArmToken.expiresOn)
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000)

      if (expiresOn > fiveMinutesFromNow) {
        return this.cachedArmToken.token
      }
    }

    try {
      if (!this.credential) {
        throw new Error('Azure credential not initialized')
      }

      console.log('Fetching ARM management token...')
      const tokenResponse = await this.credential.getToken(this.armScope)

      if (!tokenResponse) {
        throw new Error('Failed to get ARM token from Azure AD')
      }

      this.cachedArmToken = {
        token: tokenResponse.token,
        expiresOn: tokenResponse.expiresOnTimestamp
          ? new Date(tokenResponse.expiresOnTimestamp)
          : new Date(Date.now() + 60 * 60 * 1000),
      }

      return this.cachedArmToken.token
    } catch (error: any) {
      console.error('Failed to get ARM token:', error)

      if (this.cachedArmToken) {
        console.warn('Using expired cached ARM token as fallback')
        return this.cachedArmToken.token
      }

      throw new Error(`Failed to get ARM token: ${error.message}`)
    }
  }

  /**
   * Get a Cognitive Services token (scope: https://cognitiveservices.azure.com/.default).
   * Used for Azure OpenAI Chat Completions when key auth is disabled.
   */
  public async getCognitiveServicesToken(): Promise<string> {
    try {
      if (!this.credential) throw new Error('Azure credential not initialized')
      const tokenResponse = await this.credential.getToken('https://cognitiveservices.azure.com/.default')
      if (!tokenResponse) throw new Error('Failed to get CognitiveServices token')
      return tokenResponse.token
    } catch (error: any) {
      throw new Error(`Failed to get CognitiveServices token: ${error.message}`)
    }
  }
}

// Lazy singleton — only instantiated on first actual use (not at import/build time)
let _tokenManager: TokenManager | null = null
function getTokenManager(): TokenManager {
  if (!_tokenManager) {
    _tokenManager = TokenManager.getInstance()
  }
  return _tokenManager
}

// Export a helper function for API routes
export async function getFoundryBearerToken(): Promise<string> {
  // First check if we're using a static token (for backwards compatibility)
  const staticToken = process.env.FOUNDRY_BEARER_TOKEN
  if (staticToken && staticToken.length > 100) { // Assume static tokens are JWT format (long)
    return staticToken
  }

  // Otherwise use the token manager for auto-refresh
  return getTokenManager().getToken()
}

/**
 * Get an ARM management plane bearer token for Azure Resource Manager operations.
 * Used for creating/managing project connections (RemoteTool connections for MCP).
 */
export async function getArmBearerToken(): Promise<string> {
  return getTokenManager().getArmToken()
}

/**
 * Get a Cognitive Services bearer token for Azure OpenAI calls
 * when key-based auth is disabled (MCAPS policy).
 */
export async function getCognitiveServicesToken(): Promise<string> {
  return getTokenManager().getCognitiveServicesToken()
}