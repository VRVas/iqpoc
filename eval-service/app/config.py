"""Evaluation Service configuration."""

import os
from functools import lru_cache
from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
from azure.ai.projects import AIProjectClient


class Settings:
    """Application settings loaded from environment variables."""

    # Foundry
    FOUNDRY_PROJECT_ENDPOINT: str = os.environ.get(
        "FOUNDRY_PROJECT_ENDPOINT",
        "https://aikb-foundry-q36gpyt3maa7w.services.ai.azure.com/api/projects/proj-iqpoc",
    )
    FOUNDRY_MODEL_DEPLOYMENT: str = os.environ.get("FOUNDRY_MODEL_DEPLOYMENT", "gpt-4.1-mini")

    # Cosmos DB
    COSMOS_ENDPOINT: str = os.environ.get(
        "COSMOS_ENDPOINT", "https://cosmos-eval-iqpoc.documents.azure.com:443/"
    )
    COSMOS_DATABASE: str = os.environ.get("COSMOS_DATABASE", "eval-db")

    # App Insights
    APPINSIGHTS_CONNECTION_STRING: str = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING", "")

    # Auth — prefer user-assigned MI if AZURE_CLIENT_ID is set, else DefaultAzureCredential
    AZURE_CLIENT_ID: str = os.environ.get("AZURE_CLIENT_ID", "")

    # CORS
    CORS_ORIGINS: list[str] = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:3000,https://ambitious-smoke-063e2190f.1.azurestaticapps.net",
    ).split(",")

    # Service
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "info")
    VERSION: str = "1.0.0"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def get_credential():
    """Get Azure credential — Managed Identity in Azure, DefaultAzureCredential locally."""
    settings = get_settings()
    if settings.AZURE_CLIENT_ID:
        return ManagedIdentityCredential(client_id=settings.AZURE_CLIENT_ID)
    return DefaultAzureCredential()


def get_project_client() -> AIProjectClient:
    """Get Foundry AIProjectClient."""
    settings = get_settings()
    return AIProjectClient(
        endpoint=settings.FOUNDRY_PROJECT_ENDPOINT,
        credential=get_credential(),
    )


def get_openai_client():
    """Get the OpenAI-compatible client from the Foundry project (for evals API)."""
    project = get_project_client()
    return project.get_openai_client()
