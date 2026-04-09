"""Evaluation Service — FastAPI application."""

import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import health, evaluate, evaluators, continuous, red_team, responses, custom_evaluators, history, datasets, scheduled

settings = get_settings()

# ---------------------------------------------------------------------------
# OpenTelemetry + Azure Monitor instrumentation
#
# Per MS Learn: "configure_azure_monitor()" reads APPLICATIONINSIGHTS_CONNECTION_STRING
# from the environment and automatically instruments requests, dependencies,
# exceptions, and custom spans.
#
# Ref: https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable?tabs=python
# Ref: https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/trace-agent-setup
# ---------------------------------------------------------------------------
_telemetry_enabled = False
if settings.APPINSIGHTS_CONNECTION_STRING:
    try:
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor(
            connection_string=settings.APPINSIGHTS_CONNECTION_STRING,
            logger_name="app",
        )
        _telemetry_enabled = True
    except Exception as _e:
        logging.warning("Failed to configure Azure Monitor OpenTelemetry: %s", _e)

logging.basicConfig(level=settings.LOG_LEVEL.upper())
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("Eval service starting (v%s)", settings.VERSION)
    logger.info("Foundry endpoint: %s", settings.FOUNDRY_PROJECT_ENDPOINT)
    logger.info("Model deployment: %s", settings.FOUNDRY_MODEL_DEPLOYMENT)
    yield
    logger.info("Eval service shutting down")


app = FastAPI(
    title="Foundry IQ Evaluation Service",
    description="Evaluation, continuous monitoring, and red teaming for Foundry agents",
    version=settings.VERSION,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router, tags=["Health"])
app.include_router(evaluate.router, prefix="/evaluate", tags=["Evaluation"])
app.include_router(evaluators.router, prefix="/evaluators", tags=["Evaluators"])
app.include_router(continuous.router, prefix="/continuous", tags=["Continuous Evaluation"])
app.include_router(red_team.router, prefix="/red-team", tags=["Red Teaming"])
app.include_router(responses.router, prefix="/response-log", tags=["Response Log"])
app.include_router(custom_evaluators.router, prefix="/custom-evaluators", tags=["Custom Evaluators"])
app.include_router(history.router, prefix="/history", tags=["Evaluation History"])
app.include_router(datasets.router, prefix="/datasets", tags=["Datasets"])
app.include_router(scheduled.router, prefix="/scheduled", tags=["Scheduled Evaluations"])
