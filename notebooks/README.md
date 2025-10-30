# Azure AI Foundry Knowledge Base - Getting Started Notebooks

This directory contains comprehensive Jupyter notebooks demonstrating how to build Knowledge Bases using Azure AI Search and Azure AI Foundry with various data sources.

## 📚 Available Notebooks

### [foundry-knowledge-blob-storage.ipynb](foundry-knowledge-blob-storage.ipynb)
**Knowledge Base with Azure Blob Storage**

Complete end-to-end guide including Azure resource deployment:
- Deploy Azure Storage Account, AI Foundry Project, and AI Search
- Upload documents to Blob Storage
- Create knowledge source with automatic ingestion and chunking
- Build and query knowledge base
- Support for both new deployments and existing resources

**Best for:** Getting started, complete deployments, document libraries

---

### [foundry-knowledge-sharepoint-remote.ipynb](foundry-knowledge-sharepoint-remote.ipynb)
**Knowledge Base with SharePoint Online (Runtime Queries)**

Query SharePoint documents at runtime without ingestion:
- Configure SharePoint authentication
- Query SharePoint in real-time during retrieval
- Apply KQL filters for targeted searches
- No data duplication required

**Best for:** Frequently changing SharePoint content, real-time access

---

### [foundry-knowledge-sharepoint-indexed.ipynb](foundry-knowledge-sharepoint-indexed.ipynb)
**Knowledge Base with SharePoint Online (Pre-Indexed)**

Ingest and index SharePoint documents for fast retrieval:
- Create Azure AD App Registration
- Configure SharePoint permissions
- Ingest documents with automatic chunking
- Schedule periodic re-indexing
- Monitor ingestion progress

**Best for:** Production workloads, stable SharePoint content, fast queries

---

### [foundry-knowledge-onelake.ipynb](foundry-knowledge-onelake.ipynb)
**Knowledge Base with Microsoft Fabric OneLake**

Index documents from Microsoft Fabric Lakehouse:
- Set up Fabric workspace and Lakehouse
- Upload documents to OneLake
- Configure automatic re-indexing schedules
- Process text and image content
- Query indexed Lakehouse data

**Best for:** Fabric-native workflows, analytics integration, data lake scenarios

---

### [foundry-knowledge-search-index.ipynb](foundry-knowledge-search-index.ipynb)
**Knowledge Base with Existing Azure AI Search Index**

Leverage existing search indexes for knowledge retrieval:
- Create search index with semantic configuration
- Upload structured documents
- Configure search fields and metadata
- Apply OData filters for precise queries
- Real-time query without re-indexing

**Best for:** Existing search indexes, structured data, product catalogs

---

### [foundry-knowledge-mcp-github.ipynb](foundry-knowledge-mcp-github.ipynb) 🆕 BONUS
**Knowledge Base with MCP Tool (GitHub)**

Query external services using Model Context Protocol (MCP):
- Create MCP Tool knowledge source for GitHub
- Search GitHub issues and pull requests
- Configure authentication with Personal Access Token
- Query live data without ingestion
- Combine MCP tools with other sources

**Best for:** Real-time external data, GitHub integration, live API queries

**Status:** Private Preview

---

## 🚀 Quick Start

### Recommended Learning Path

1. **Start Here:** [foundry-knowledge-search-index.ipynb](foundry-knowledge-search-index.ipynb)
   - Easiest to test
   - No external dependencies
   - Complete in 10-15 minutes

2. **Next:** [foundry-knowledge-blob-storage.ipynb](foundry-knowledge-blob-storage.ipynb)
   - Most comprehensive
   - Includes Azure deployment
   - Complete in 20-30 minutes

3. **Advanced:** Try SharePoint or OneLake notebooks if you have access
4. **Bonus:** Explore [foundry-knowledge-mcp-github.ipynb](foundry-knowledge-mcp-github.ipynb) for external API integration

### Prerequisites

**All Notebooks:**
- Azure subscription
- Azure CLI installed and logged in (`az login`)
- Python 3.9+ with Jupyter
- Basic understanding of Azure AI Search

**Specific Requirements:**
- **Blob Storage:** Azure Storage Account
- **SharePoint Remote:** SharePoint Online site with documents
- **SharePoint Indexed:** Azure AD admin access for App Registration
- **OneLake:** Microsoft Fabric capacity or trial
- **Search Index:** None (can create new index)
- **MCP GitHub:** GitHub Personal Access Token (free)

---

## 📖 What You'll Learn

### Core Concepts

1. **Knowledge Sources:** Different data source types (Blob, SharePoint, OneLake, Search Index)
2. **Knowledge Bases:** Combine multiple knowledge sources for intelligent retrieval
3. **Ingestion:** Automatic document chunking, embedding, and indexing
4. **Querying:** Natural language queries with answer synthesis
5. **Filtering:** Apply filters for targeted retrieval

### Azure Resources

- Azure AI Search (Knowledge Base service)
- Azure AI Foundry (Embedding and chat models)
- Azure Blob Storage (Document storage)
- SharePoint Online (Enterprise content)
- Microsoft Fabric OneLake (Data lake)

---

## 🏗️ Architecture

```
Data Source → Knowledge Source → Knowledge Base → Retrieval API
                      ↓
          Chunking + Embedding + Indexing
                      ↓
            Azure AI Search Index
```

### Data Flow

1. **Ingestion:** Documents are processed, chunked, and embedded
2. **Indexing:** Chunks stored in Azure AI Search with vectors
3. **Retrieval:** Natural language query finds relevant chunks
4. **Synthesis:** LLM generates answer from retrieved content

---

## 💡 Key Features

### All Notebooks Include

✅ **Step-by-step instructions** - Clear, detailed explanations
✅ **Azure CLI commands** - Automated resource deployment (Blob Storage notebook)
✅ **Sample data** - Ready-to-use example documents
✅ **Query examples** - Various retrieval scenarios
✅ **Cleanup sections** - Avoid unnecessary costs
✅ **Comparison tables** - Help choose the right approach
✅ **Architecture diagrams** - Visual understanding

### Unique Features by Notebook

| Notebook | Unique Features |
|----------|----------------|
| Blob Storage | Full Azure deployment, new vs. existing resources |
| SharePoint Remote | KQL filters, runtime queries, no ingestion |
| SharePoint Indexed | App Registration, scheduled re-indexing |
| OneLake | Fabric integration, image processing |
| Search Index | OData filters, structured metadata, semantic search |
| MCP GitHub | External API integration, real-time data, GitHub issues/PRs |

---

## 🔍 Choosing the Right Notebook

### Use Blob Storage When:
- You have documents in Azure Storage
- You need full control over deployment
- You're building a new knowledge base from scratch

### Use SharePoint Remote When:
- Documents change frequently
- You need real-time access to SharePoint
- You want to avoid data duplication

### Use SharePoint Indexed When:
- You need fast, production-grade queries
- SharePoint content is relatively stable
- You can schedule periodic re-indexing

### Use OneLake When:
- You're using Microsoft Fabric
- You need analytics integration
- You have data lake workflows

### Use Search Index When:
- You already have an Azure AI Search index
- You need complex filtering on structured data
- You're building product catalogs or directories

### Use MCP GitHub When:
- You need to query GitHub issues or PRs in real-time
- You want to combine code repository data with docs
- You need live external API data without ingestion
- You're building developer support tools

---

## 📊 Comparison Matrix

| Feature | Blob | SharePoint Remote | SharePoint Indexed | OneLake | Search Index | MCP GitHub |
|---------|------|-------------------|-------------------|---------|--------------|------------|
| **Setup Complexity** | Medium | Low | High | Medium | Low | Very Low |
| **Query Latency** | Low | Medium | Low | Low | Very Low | Medium |
| **Data Freshness** | Scheduled | Real-time | Scheduled | Scheduled | Real-time | Real-time |
| **Filtering** | Limited | KQL | Limited | Limited | OData | API-based |
| **Storage Cost** | Yes | No | Yes | Yes | Yes | No |
| **Best Use Case** | Docs | Live content | Production | Analytics | Catalogs | External APIs |

---

## 🧪 Testing

All notebooks have been validated for correctness. See [TEST_RESULTS.md](../TEST_RESULTS.md) for details.

**Tested:**
- ✅ API endpoints and payloads
- ✅ Azure CLI commands
- ✅ End-to-end workflow (Search Index)
- ✅ Sample data and queries

---

## 🛠️ Troubleshooting

### Common Issues

**"Module not found" errors:**
```bash
pip install jupyter requests
```

**"Invalid API key" errors:**
- Verify your Search API key in Azure Portal
- Ensure Foundry endpoint and key are correct

**Ingestion taking too long:**
- Check knowledge source status endpoint
- Large files may take 10-15 minutes
- Verify models are deployed in Foundry

**No results from queries:**
- Wait for ingestion to complete
- Check documents were uploaded correctly
- Verify semantic configuration is set

---

## 📚 Additional Resources

- [Azure AI Search Documentation](https://learn.microsoft.com/azure/search/)
- [Azure AI Foundry Documentation](https://learn.microsoft.com/azure/ai-studio/)
- [Knowledge Base API Reference](https://learn.microsoft.com/rest/api/searchservice/)

---

## 🤝 Contributing

Found an issue or have suggestions? Please open an issue in the repository.

---

## 📝 License

These notebooks are provided as-is for educational purposes.

---

**Happy Learning! 🎉**

For questions or feedback, please refer to the main repository documentation.
