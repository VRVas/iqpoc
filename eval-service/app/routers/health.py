"""Health check endpoint."""

from fastapi import APIRouter
from app.config import get_settings

router = APIRouter()


@router.get("/health")
async def health():
    """Service health check."""
    settings = get_settings()
    return {
        "status": "healthy",
        "version": settings.VERSION,
        "foundry_endpoint": settings.FOUNDRY_PROJECT_ENDPOINT[:50] + "...",
        "model_deployment": settings.FOUNDRY_MODEL_DEPLOYMENT,
        "app_insights_configured": bool(settings.APPINSIGHTS_CONNECTION_STRING),
        "telemetry_enabled": getattr(__import__("app.main", fromlist=["_telemetry_enabled"]), "_telemetry_enabled", False),
    }
