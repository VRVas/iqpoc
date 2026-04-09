"""Dataset management — upload, list, and use versioned datasets.

Per MS Learn: "Upload a JSONL or CSV file to create a versioned dataset in your
Foundry project. Datasets support versioning and reuse across multiple evaluation
runs. Use this approach for production testing and CI/CD workflows."

SDK patterns:
  project_client.datasets.upload_file(name=..., version=..., file_path=...)
  The returned object has .id which is used as file_id in evals.

Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#upload-a-dataset-recommended
"""

import logging
import os
import tempfile
import json
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from app.config import get_project_client, get_openai_client, get_settings
from app.services.eval_service import build_testing_criteria

router = APIRouter()
logger = logging.getLogger("app")


class InlineDatasetUploadRequest(BaseModel):
    """Upload inline JSONL data as a versioned dataset."""
    name: str
    version: str = "1"
    items: list[dict] = Field(..., min_length=1)
    description: Optional[str] = None


class DatasetEvalRequest(BaseModel):
    """Run an evaluation using an uploaded dataset (by file_id)."""
    name: str = "Dataset File Evaluation"
    dataset_id: str  # file_id from datasets.upload_file()
    dataset_type: str = "jsonl"  # jsonl or csv
    evaluators: list[str] = Field(default_factory=lambda: ["coherence", "violence"])
    model_deployment: Optional[str] = None
    item_schema: Optional[dict] = None  # Override auto-detected schema


class CsvUploadRequest(BaseModel):
    """Upload inline CSV data as a versioned dataset.

    Per MS Learn: CSV files with column headers matching evaluator fields.
    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#csv-dataset-evaluation
    """
    name: str
    version: str = "1"
    csv_text: str  # Raw CSV text with headers


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/upload-inline")
async def upload_inline_dataset(req: InlineDatasetUploadRequest):
    """Upload inline data as a versioned JSONL dataset to the Foundry project.

    Per MS Learn: "project_client.datasets.upload_file(name=..., version=..., file_path=...)"
    We write the items to a temp JSONL file, upload it, then return the dataset_id.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#upload-a-dataset-recommended
    """
    try:
        project_client = get_project_client()

        # Write items to a temp JSONL file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
            for item in req.items:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
            temp_path = f.name

        try:
            # Upload to Foundry
            dataset = project_client.datasets.upload_file(
                name=req.name,
                version=req.version,
                file_path=temp_path,
            )
            logger.info("Uploaded dataset '%s' v%s: id=%s", req.name, req.version, dataset.id)

            return {
                "status": "uploaded",
                "dataset_id": dataset.id,
                "name": req.name,
                "version": req.version,
                "item_count": len(req.items),
            }
        finally:
            os.unlink(temp_path)

    except Exception as e:
        logger.exception("Failed to upload inline dataset")
        raise HTTPException(500, str(e))


@router.post("/upload-file")
async def upload_file_dataset(
    file: UploadFile = File(...),
    name: str = Form(...),
    version: str = Form(default="1"),
):
    """Upload a JSONL or CSV file as a versioned dataset.

    Accepts multipart file upload for larger datasets.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#upload-a-dataset-recommended
    """
    try:
        project_client = get_project_client()

        # Determine file extension
        suffix = ".jsonl"
        if file.filename and file.filename.endswith(".csv"):
            suffix = ".csv"

        # Write uploaded content to temp file
        with tempfile.NamedTemporaryFile(mode="wb", suffix=suffix, delete=False) as f:
            content = await file.read()
            f.write(content)
            temp_path = f.name

        try:
            dataset = project_client.datasets.upload_file(
                name=name,
                version=version,
                file_path=temp_path,
            )
            logger.info("Uploaded file dataset '%s' v%s: id=%s", name, version, dataset.id)

            return {
                "status": "uploaded",
                "dataset_id": dataset.id,
                "name": name,
                "version": version,
                "filename": file.filename,
                "size_bytes": len(content),
            }
        finally:
            os.unlink(temp_path)

    except Exception as e:
        logger.exception("Failed to upload file dataset")
        raise HTTPException(500, str(e))


@router.post("/upload-csv")
async def upload_csv_dataset(req: CsvUploadRequest):
    """Upload inline CSV text as a versioned dataset.

    Parses CSV text with headers, converts to either:
    - A CSV file uploaded directly (Foundry supports CSV natively)
    - Or a JSONL file converted from CSV rows

    Per MS Learn: "CSV files with column headers matching evaluator fields.
    Each row represents one test case."
    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#csv-dataset-evaluation
    """
    import csv
    import io

    try:
        project_client = get_project_client()

        # Parse CSV to validate it
        reader = csv.DictReader(io.StringIO(req.csv_text))
        rows = list(reader)
        if not rows:
            raise HTTPException(400, "CSV is empty or has no data rows")

        columns = list(rows[0].keys())
        logger.info("Parsed CSV: %d rows, columns: %s", len(rows), columns)

        # Write as CSV file for Foundry upload
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8", newline="") as f:
            f.write(req.csv_text)
            temp_path = f.name

        try:
            dataset = project_client.datasets.upload_file(
                name=req.name,
                version=req.version,
                file_path=temp_path,
            )
            logger.info("Uploaded CSV dataset '%s' v%s: id=%s", req.name, req.version, dataset.id)

            return {
                "status": "uploaded",
                "dataset_id": dataset.id,
                "name": req.name,
                "version": req.version,
                "format": "csv",
                "row_count": len(rows),
                "columns": columns,
            }
        finally:
            os.unlink(temp_path)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to upload CSV dataset")
        raise HTTPException(500, str(e))


@router.post("/evaluate")
async def evaluate_with_dataset(req: DatasetEvalRequest):
    """Run an evaluation using an uploaded dataset file_id.

    Per MS Learn, uses SourceFileID with the dataset ID:
      data_source=CreateEvalJSONLRunDataSourceParam(
          type="jsonl", source=SourceFileID(type="file_id", id=data_id)
      )

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#create-evaluation-and-run
    """
    try:
        from openai.types.eval_create_params import DataSourceConfigCustom

        settings = get_settings()
        client = get_openai_client()
        model = req.model_deployment or settings.FOUNDRY_MODEL_DEPLOYMENT

        # Auto-detect schema or use provided
        schema = req.item_schema or {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "response": {"type": "string"},
                "context": {"type": "string"},
                "ground_truth": {"type": "string"},
            },
            "required": [],
        }

        data_source_config = DataSourceConfigCustom(
            type="custom",
            item_schema=schema,
            include_sample_schema=True,
        )

        testing_criteria = build_testing_criteria(req.evaluators, model, eval_mode="dataset")

        eval_obj = client.evals.create(
            name=req.name,
            data_source_config=data_source_config,
            testing_criteria=testing_criteria,
        )
        logger.info("Created dataset file eval: %s", eval_obj.id)

        # Create run using the uploaded dataset file_id
        eval_run = client.evals.runs.create(
            eval_id=eval_obj.id,
            name=f"{req.name} run",
            data_source={
                "type": req.dataset_type,
                "source": {
                    "type": "file_id",
                    "id": req.dataset_id,
                },
            },
        )
        logger.info("Created dataset file eval run: %s", eval_run.id)

        return {
            "eval_id": eval_obj.id,
            "run_id": eval_run.id,
            "status": eval_run.status,
            "dataset_id": req.dataset_id,
            "poll_url": f"/evaluate/status/{eval_run.id}?eval_id={eval_obj.id}",
        }

    except Exception as e:
        logger.exception("Failed to run dataset file evaluation")
        raise HTTPException(500, str(e))
