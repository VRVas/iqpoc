/**
 * Vitest global setup file.
 * Sets up environment variables and mocks for Next.js API route testing.
 */

// Mock environment variables
process.env.EVAL_SERVICE_URL = 'http://mock-eval-service:8000'
process.env.AZURE_SEARCH_ENDPOINT = 'https://test.search.windows.net'
process.env.AZURE_SEARCH_API_KEY = 'test-key'
process.env.NEXT_PUBLIC_AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com'
process.env.AZURE_OPENAI_API_KEY = 'test-key'
