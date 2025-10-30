#!/usr/bin/env python3
"""
Test script for Knowledge Base notebooks
Tests each notebook end-to-end using existing Azure resources
"""

import requests
import json
import time
import os
import subprocess

# Configuration from existing resources
SEARCH_ENDPOINT = "https://farzad-srch-wcus-basic.search.windows.net"
SEARCH_API_KEY = "TCpOidOFv6rQUHsGEdymfJUmTqBFLQDZaBWUvKYQrnAzSeBHEJ95"
API_VERSION = "2025-11-01-preview"

FOUNDRY_ENDPOINT = "https://fsunavala-enovate-dev-resource.services.ai.azure.com"
AZURE_OPENAI_KEY = "48kZEWMe3lMUUmYQz6YNHhPjB52poTewjUhJMZl4ZYAhGK5NuzRoJQQJ99BIACHYHv6XJ3w3AAAAACOGBx1r"
EMBEDDING_DEPLOYMENT = "text-embedding-3-small"
CHAT_DEPLOYMENT = "gpt-5-nano"

BLOB_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=enovatesaidevstorage;AccountKey=KU8558brMnkoyCu4Jc6sGWsrOKVxWXKSIuoofDUQ8u2QHq4VnXwAWkJRPryCxbiMnhjWBIQnPv2L+AStx4oklw==;EndpointSuffix=core.windows.net"
STORAGE_CONTAINER = "test-kb-docs"


def print_test_header(title):
    """Print a formatted test header"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80 + "\n")


def print_section(title):
    """Print a section header"""
    print(f"\n--- {title} ---\n")


def test_01_blob_storage_kb():
    """Test Notebook 01: Blob Storage Knowledge Base"""
    print_test_header("TEST 01: Blob Storage Knowledge Base")

    headers = {
        "api-key": SEARCH_API_KEY,
        "Content-Type": "application/json"
    }

    # Test variables
    KNOWLEDGE_SOURCE_NAME = "test-blob-source-01"
    KNOWLEDGE_BASE_NAME = "test-blob-kb-01"

    try:
        # Step 1: Create sample documents locally
        print_section("Step 1: Create sample documents")
        os.makedirs("test_docs_01", exist_ok=True)

        with open("test_docs_01/product.txt", "w") as f:
            f.write("CloudMax Platform features: auto-scaling, managed databases, AI/ML capabilities, 99.99% SLA.")

        with open("test_docs_01/faq.txt", "w") as f:
            f.write("Q: How to reset password? A: Click 'Forgot Password' on login page.")

        print("✅ Sample documents created")

        # Step 2: Upload to blob storage using Azure CLI
        print_section("Step 2: Upload documents to blob storage")

        # Create container if it doesn't exist
        result = subprocess.run(
            ["az", "storage", "container", "create",
             "--name", STORAGE_CONTAINER,
             "--connection-string", BLOB_CONNECTION_STRING],
            capture_output=True,
            text=True
        )

        # Upload files
        result = subprocess.run(
            ["az", "storage", "blob", "upload-batch",
             "--destination", STORAGE_CONTAINER,
             "--source", "./test_docs_01",
             "--connection-string", BLOB_CONNECTION_STRING,
             "--overwrite"],
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            print("✅ Documents uploaded to blob storage")
        else:
            print(f"⚠️  Upload warning: {result.stderr}")

        # Step 3: Create knowledge source
        print_section("Step 3: Create blob knowledge source")

        url = f"{SEARCH_ENDPOINT}/knowledgeSources/{KNOWLEDGE_SOURCE_NAME}?api-version={API_VERSION}"

        body = {
            "name": KNOWLEDGE_SOURCE_NAME,
            "kind": "azureBlob",
            "description": "Test blob storage knowledge source",
            "azureBlobParameters": {
                "connectionString": BLOB_CONNECTION_STRING,
                "containerName": STORAGE_CONTAINER,
                "folderPath": "",
                "isADLSGen2": False,
                "ingestionParameters": {
                    "identity": None,
                    "embeddingModel": {
                        "kind": "azureOpenAI",
                        "azureOpenAIParameters": {
                            "resourceUri": FOUNDRY_ENDPOINT,
                            "deploymentId": EMBEDDING_DEPLOYMENT,
                            "modelName": EMBEDDING_DEPLOYMENT,
                            "apiKey": AZURE_OPENAI_KEY
                        }
                    },
                    "chatCompletionModel": {
                        "kind": "azureOpenAI",
                        "azureOpenAIParameters": {
                            "resourceUri": FOUNDRY_ENDPOINT,
                            "deploymentId": CHAT_DEPLOYMENT,
                            "modelName": CHAT_DEPLOYMENT,
                            "apiKey": AZURE_OPENAI_KEY
                        }
                    },
                    "disableImageVerbalization": False,
                    "contentExtractionMode": "minimal"
                }
            }
        }

        response = requests.put(url, headers=headers, json=body)
        print(f"Status: {response.status_code}")

        if response.status_code in [200, 201]:
            print("✅ Knowledge source created")
        else:
            print(f"❌ Failed to create knowledge source: {response.text}")
            return False

        # Step 4: Monitor ingestion
        print_section("Step 4: Monitor ingestion progress")

        status_url = f"{SEARCH_ENDPOINT}/knowledgeSources/{KNOWLEDGE_SOURCE_NAME}/status?api-version={API_VERSION}"

        for i in range(30):  # Wait up to 5 minutes
            response = requests.get(status_url, headers=headers)
            status = response.json()

            current_status = status.get("status", "unknown")
            print(f"Attempt {i+1}: Status = {current_status}")

            if current_status == "succeeded":
                print("✅ Ingestion completed successfully")
                break
            elif current_status == "failed":
                print(f"❌ Ingestion failed: {json.dumps(status, indent=2)}")
                return False

            time.sleep(10)

        # Step 5: Create knowledge base
        print_section("Step 5: Create knowledge base")

        url = f"{SEARCH_ENDPOINT}/knowledgeBases/{KNOWLEDGE_BASE_NAME}?api-version={API_VERSION}"

        body = {
            "name": KNOWLEDGE_BASE_NAME,
            "description": "Test blob storage knowledge base",
            "knowledgeSources": [
                {"name": KNOWLEDGE_SOURCE_NAME}
            ],
            "models": [
                {
                    "kind": "azureOpenAI",
                    "azureOpenAIParameters": {
                        "resourceUri": FOUNDRY_ENDPOINT,
                        "deploymentId": CHAT_DEPLOYMENT,
                        "modelName": CHAT_DEPLOYMENT,
                        "apiKey": AZURE_OPENAI_KEY
                    }
                }
            ],
            "outputMode": "answerSynthesis",
            "retrievalInstructions": "Provide accurate information.",
            "answerInstructions": "Provide clear answers with citations."
        }

        response = requests.put(url, headers=headers, json=body)
        print(f"Status: {response.status_code}")

        if response.status_code in [200, 201]:
            print("✅ Knowledge base created")
        else:
            print(f"❌ Failed to create knowledge base: {response.text}")
            return False

        # Step 6: Query knowledge base
        print_section("Step 6: Query knowledge base")

        url = f"{SEARCH_ENDPOINT}/knowledgeBases/{KNOWLEDGE_BASE_NAME}/retrieve?api-version={API_VERSION}"

        query_body = {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "What are the key features of CloudMax?"
                        }
                    ]
                }
            ],
            "includeActivity": True
        }

        response = requests.post(url, headers=headers, json=query_body)

        if response.status_code == 200:
            result = response.json()
            print("✅ Query successful!")
            print(f"\nAnswer: {result['choices'][0]['message']['content']}")

            refs = result.get("activity", {}).get("references", [])
            if refs:
                print(f"\nReferences: {len(refs)} found")
        else:
            print(f"❌ Query failed: {response.text}")
            return False

        # Cleanup
        print_section("Cleanup")

        # Delete KB
        url = f"{SEARCH_ENDPOINT}/knowledgeBases/{KNOWLEDGE_BASE_NAME}?api-version={API_VERSION}"
        response = requests.delete(url, headers=headers)
        print(f"Delete KB: {response.status_code}")

        # Delete KS
        url = f"{SEARCH_ENDPOINT}/knowledgeSources/{KNOWLEDGE_SOURCE_NAME}?api-version={API_VERSION}"
        response = requests.delete(url, headers=headers)
        print(f"Delete KS: {response.status_code}")

        print("\n✅ TEST 01 PASSED")
        return True

    except Exception as e:
        print(f"\n❌ TEST 01 FAILED: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


def test_05_search_index_kb():
    """Test Notebook 05: Existing Search Index Knowledge Source"""
    print_test_header("TEST 05: Existing Search Index Knowledge Source")

    headers = {
        "api-key": SEARCH_API_KEY,
        "Content-Type": "application/json"
    }

    # Test variables
    SEARCH_INDEX_NAME = "test-products-index-05"
    KNOWLEDGE_SOURCE_NAME = "test-index-source-05"
    KNOWLEDGE_BASE_NAME = "test-index-kb-05"

    try:
        # Step 1: Create search index
        print_section("Step 1: Create search index")

        url = f"{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX_NAME}?api-version={API_VERSION}"

        index_schema = {
            "name": SEARCH_INDEX_NAME,
            "fields": [
                {"name": "id", "type": "Edm.String", "key": True, "filterable": True},
                {"name": "title", "type": "Edm.String", "searchable": True},
                {"name": "content", "type": "Edm.String", "searchable": True},
                {"name": "category", "type": "Edm.String", "filterable": True}
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
        }

        response = requests.put(url, headers=headers, json=index_schema)
        print(f"Status: {response.status_code}")

        if response.status_code in [200, 201]:
            print("✅ Search index created")
        else:
            print(f"❌ Failed to create index: {response.text}")
            return False

        # Step 2: Upload documents
        print_section("Step 2: Upload documents to index")

        url = f"{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX_NAME}/docs/index?api-version={API_VERSION}"

        documents = {
            "value": [
                {
                    "@search.action": "upload",
                    "id": "1",
                    "title": "Laptop Pro 15",
                    "content": "High-performance laptop with 15-inch display, i7 processor, 16GB RAM.",
                    "category": "electronics"
                },
                {
                    "@search.action": "upload",
                    "id": "2",
                    "title": "Wireless Mouse",
                    "content": "Ergonomic wireless mouse with precision tracking.",
                    "category": "accessories"
                }
            ]
        }

        response = requests.post(url, headers=headers, json=documents)
        print(f"Status: {response.status_code}")

        if response.status_code == 200:
            print("✅ Documents uploaded")
        else:
            print(f"❌ Failed to upload documents: {response.text}")
            return False

        # Wait for indexing
        time.sleep(3)

        # Step 3: Create knowledge source
        print_section("Step 3: Create knowledge source from index")

        url = f"{SEARCH_ENDPOINT}/knowledgeSources/{KNOWLEDGE_SOURCE_NAME}?api-version={API_VERSION}"

        body = {
            "name": KNOWLEDGE_SOURCE_NAME,
            "kind": "searchIndex",
            "description": "Test search index knowledge source",
            "searchIndexParameters": {
                "searchIndexName": SEARCH_INDEX_NAME,
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
        }

        response = requests.put(url, headers=headers, json=body)
        print(f"Status: {response.status_code}")

        if response.status_code in [200, 201]:
            print("✅ Knowledge source created")
        else:
            print(f"❌ Failed to create knowledge source: {response.text}")
            return False

        # Step 4: Create knowledge base
        print_section("Step 4: Create knowledge base")

        url = f"{SEARCH_ENDPOINT}/knowledgeBases/{KNOWLEDGE_BASE_NAME}?api-version={API_VERSION}"

        body = {
            "name": KNOWLEDGE_BASE_NAME,
            "description": "Test search index knowledge base",
            "knowledgeSources": [
                {"name": KNOWLEDGE_SOURCE_NAME}
            ],
            "models": [
                {
                    "kind": "azureOpenAI",
                    "azureOpenAIParameters": {
                        "resourceUri": FOUNDRY_ENDPOINT,
                        "deploymentId": CHAT_DEPLOYMENT,
                        "modelName": CHAT_DEPLOYMENT,
                        "apiKey": AZURE_OPENAI_KEY
                    }
                }
            ],
            "outputMode": "answerSynthesis",
            "retrievalInstructions": "Provide product information.",
            "answerInstructions": "Give helpful recommendations."
        }

        response = requests.put(url, headers=headers, json=body)
        print(f"Status: {response.status_code}")

        if response.status_code in [200, 201]:
            print("✅ Knowledge base created")
        else:
            print(f"❌ Failed to create knowledge base: {response.text}")
            return False

        # Step 5: Query knowledge base
        print_section("Step 5: Query knowledge base")

        url = f"{SEARCH_ENDPOINT}/knowledgeBases/{KNOWLEDGE_BASE_NAME}/retrieve?api-version={API_VERSION}"

        query_body = {
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
            "includeActivity": True
        }

        response = requests.post(url, headers=headers, json=query_body)

        if response.status_code == 200:
            result = response.json()
            print("✅ Query successful!")
            print(f"\nAnswer: {result['choices'][0]['message']['content']}")
        else:
            print(f"❌ Query failed: {response.text}")
            return False

        # Cleanup
        print_section("Cleanup")

        url = f"{SEARCH_ENDPOINT}/knowledgeBases/{KNOWLEDGE_BASE_NAME}?api-version={API_VERSION}"
        response = requests.delete(url, headers=headers)
        print(f"Delete KB: {response.status_code}")

        url = f"{SEARCH_ENDPOINT}/knowledgeSources/{KNOWLEDGE_SOURCE_NAME}?api-version={API_VERSION}"
        response = requests.delete(url, headers=headers)
        print(f"Delete KS: {response.status_code}")

        url = f"{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX_NAME}?api-version={API_VERSION}"
        response = requests.delete(url, headers=headers)
        print(f"Delete Index: {response.status_code}")

        print("\n✅ TEST 05 PASSED")
        return True

    except Exception as e:
        print(f"\n❌ TEST 05 FAILED: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("\n" + "="*80)
    print("  KNOWLEDGE BASE NOTEBOOKS - END-TO-END TESTING")
    print("="*80)

    results = {}

    # Test notebooks that don't require special setup
    results["01 - Blob Storage"] = test_01_blob_storage_kb()
    results["05 - Search Index"] = test_05_search_index_kb()

    # Summary
    print("\n" + "="*80)
    print("  TEST SUMMARY")
    print("="*80 + "\n")

    for test_name, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{test_name}: {status}")

    total = len(results)
    passed = sum(1 for v in results.values() if v)

    print(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
