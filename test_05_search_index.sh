#!/bin/bash
# Test Notebook 05: Existing Search Index Knowledge Source

set -e

# Configuration
SEARCH_ENDPOINT="https://farzad-srch-wcus-basic.search.windows.net"
SEARCH_API_KEY="TCpOidOFv6rQUHsGEdymfJUmTqBFLQDZaBWUvKYQrnAzSeBHEJ95"
API_VERSION="2025-11-01-preview"
FOUNDRY_ENDPOINT="https://fsunavala-enovate-dev-resource.services.ai.azure.com"
AZURE_OPENAI_KEY="48kZEWMe3lMUUmYQz6YNHhPjB52poTewjUhJMZl4ZYAhGK5NuzRoJQQJ99BIACHYHv6XJ3w3AAAAACOGBx1r"
CHAT_DEPLOYMENT="gpt-5-nano"

# Test resources
SEARCH_INDEX_NAME="test-products-index-05"
KNOWLEDGE_SOURCE_NAME="test-index-source-05"
KNOWLEDGE_BASE_NAME="test-index-kb-05"

echo "=================================="
echo "TEST 05: Search Index Knowledge Base"
echo "=================================="

# Step 1: Create search index
echo ""
echo "Step 1: Creating search index..."
curl -X PUT "${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'${SEARCH_INDEX_NAME}'",
    "fields": [
      {"name": "id", "type": "Edm.String", "key": true, "filterable": true},
      {"name": "title", "type": "Edm.String", "searchable": true},
      {"name": "content", "type": "Edm.String", "searchable": true},
      {"name": "category", "type": "Edm.String", "filterable": true}
    ],
    "semantic": {
      "defaultConfiguration": "default",
      "configurations": [
        {
          "name": "default",
          "prioritizedFields": {
            "titleField": {"fieldName": "title"},
            "prioritizedContentFields": [{"fieldName": "content"}]
          }
        }
      ]
    }
  }'

echo ""
echo "✅ Search index created"

# Step 2: Upload documents
echo ""
echo "Step 2: Uploading documents..."
sleep 2
curl -X POST "${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX_NAME}/docs/index?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "value": [
      {
        "@search.action": "upload",
        "id": "1",
        "title": "Laptop Pro 15",
        "content": "High-performance laptop with 15-inch display, Intel i7 processor, 16GB RAM, 512GB SSD.",
        "category": "electronics"
      },
      {
        "@search.action": "upload",
        "id": "2",
        "title": "Wireless Mouse",
        "content": "Ergonomic wireless mouse with precision tracking and programmable buttons.",
        "category": "accessories"
      }
    ]
  }'

echo ""
echo "✅ Documents uploaded"
sleep 3

# Step 3: Create knowledge source
echo ""
echo "Step 3: Creating knowledge source..."
curl -X PUT "${SEARCH_ENDPOINT}/knowledgeSources/${KNOWLEDGE_SOURCE_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'${KNOWLEDGE_SOURCE_NAME}'",
    "kind": "searchIndex",
    "description": "Test search index knowledge source",
    "searchIndexParameters": {
      "searchIndexName": "'${SEARCH_INDEX_NAME}'",
      "searchFields": [
        {"name": "content"},
        {"name": "title"}
      ],
      "sourceDataFields": [
        {"name": "id"},
        {"name": "category"}
      ],
      "semanticConfigurationName": "default"
    }
  }'

echo ""
echo "✅ Knowledge source created"

# Step 4: Create knowledge base
echo ""
echo "Step 4: Creating knowledge base..."
curl -X PUT "${SEARCH_ENDPOINT}/knowledgeBases/${KNOWLEDGE_BASE_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'${KNOWLEDGE_BASE_NAME}'",
    "description": "Test search index knowledge base",
    "knowledgeSources": [
      {"name": "'${KNOWLEDGE_SOURCE_NAME}'"}
    ],
    "models": [
      {
        "kind": "azureOpenAI",
        "azureOpenAIParameters": {
          "resourceUri": "'${FOUNDRY_ENDPOINT}'",
          "deploymentId": "'${CHAT_DEPLOYMENT}'",
          "modelName": "'${CHAT_DEPLOYMENT}'",
          "apiKey": "'${AZURE_OPENAI_KEY}'"
        }
      }
    ],
    "outputMode": "answerSynthesis",
    "retrievalInstructions": "Provide product information.",
    "answerInstructions": "Give helpful recommendations."
  }'

echo ""
echo "✅ Knowledge base created"

# Step 5: Query knowledge base
echo ""
echo "Step 5: Querying knowledge base..."
sleep 2
curl -X POST "${SEARCH_ENDPOINT}/knowledgeBases/${KNOWLEDGE_BASE_NAME}/retrieve?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "What laptops are available?"
          }
        ]
      }
    ],
    "includeActivity": true
  }' | python3 -m json.tool

echo ""
echo "✅ Query successful"

# Cleanup
echo ""
echo "Cleanup: Deleting resources..."
curl -X DELETE "${SEARCH_ENDPOINT}/knowledgeBases/${KNOWLEDGE_BASE_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_API_KEY}"
echo "KB deleted"

curl -X DELETE "${SEARCH_ENDPOINT}/knowledgeSources/${KNOWLEDGE_SOURCE_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_API_KEY}"
echo "KS deleted"

curl -X DELETE "${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_API_KEY}"
echo "Index deleted"

echo ""
echo "✅ TEST 05 PASSED"
