"""Evaluation history — list past evaluations and runs.

Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#get-results

Key SDK patterns:
  client.evals.list() — list all evaluations in the project
  client.evals.runs.list(eval_id=...) — list runs for a specific evaluation
  client.evals.runs.retrieve(run_id=..., eval_id=...) — get run details
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException

from app.config import get_openai_client

router = APIRouter()
logger = logging.getLogger("app")


@router.get("/evals")
async def list_evaluations(limit: int = 20, order: str = "desc"):
    """List all evaluations in the Foundry project.

    Returns eval IDs, names, status, and creation timestamps.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python
    """
    try:
        client = get_openai_client()
        evals_page = client.evals.list(limit=min(limit, 100), order=order)

        results = []
        for ev in evals_page.data:
            name = getattr(ev, "name", "")
            # Detect red team evals by name pattern or data_source_config
            eval_type = "red_team" if "red team" in name.lower() else "evaluation"
            results.append({
                "id": getattr(ev, "id", ""),
                "name": name,
                "type": eval_type,
                "created_at": getattr(ev, "created_at", None),
                "metadata": getattr(ev, "metadata", {}),
            })

        return {"evaluations": results, "total": len(results)}

    except Exception as e:
        logger.exception("Failed to list evaluations")
        raise HTTPException(500, str(e))


@router.get("/evals/{eval_id}/runs")
async def list_eval_runs(eval_id: str, limit: int = 20, order: str = "desc"):
    """List all runs for a specific evaluation.

    Returns run IDs, status, result counts, and report URLs.

    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#get-results
    """
    try:
        client = get_openai_client()
        runs_page = client.evals.runs.list(eval_id=eval_id, limit=min(limit, 100), order=order)

        results = []
        for run in runs_page.data:
            run_data = {
                "id": getattr(run, "id", ""),
                "eval_id": eval_id,
                "name": getattr(run, "name", ""),
                "status": getattr(run, "status", "unknown"),
                "created_at": getattr(run, "created_at", None),
                "report_url": getattr(run, "report_url", None),
                "result_counts": None,
                "per_evaluator": None,
            }

            # Extract result counts if available
            if hasattr(run, "result_counts") and run.result_counts:
                run_data["result_counts"] = {
                    "total": getattr(run.result_counts, "total", 0),
                    "passed": getattr(run.result_counts, "passed", 0),
                    "failed": getattr(run.result_counts, "failed", 0),
                    "errored": getattr(run.result_counts, "errored", 0),
                }

            # Extract per-evaluator results if available
            if hasattr(run, "per_testing_criteria_results") and run.per_testing_criteria_results:
                run_data["per_evaluator"] = [
                    {
                        "name": getattr(r, "testing_criteria", str(r)),
                        "passed": getattr(r, "passed", 0),
                        "failed": getattr(r, "failed", 0),
                        "pass_rate": getattr(r, "pass_rate", 0),
                    }
                    for r in run.per_testing_criteria_results
                ]

            results.append(run_data)

        return {"runs": results, "total": len(results), "eval_id": eval_id}

    except Exception as e:
        logger.exception("Failed to list runs for eval %s", eval_id)
        raise HTTPException(500, str(e))


@router.get("/recent-runs")
async def list_recent_runs(limit: int = 20):
    """List the most recent evaluation AND red team runs.

    Merges standard evals from client.evals.list() with red team runs
    from the local registry (since Foundry's evals.list() excludes red team evals).
    """
    try:
        client = get_openai_client()

        # Get recent evaluations
        evals_page = client.evals.list(limit=10, order="desc")

        all_runs = []
        for ev in evals_page.data:
            try:
                eval_name = getattr(ev, "name", "")
                eval_type = "red_team" if "red team" in eval_name.lower() else "evaluation"
                runs_page = client.evals.runs.list(eval_id=ev.id, limit=5, order="desc")
                for run in runs_page.data:
                    run_data = {
                        "id": getattr(run, "id", ""),
                        "eval_id": ev.id,
                        "eval_name": eval_name,
                        "type": eval_type,
                        "name": getattr(run, "name", ""),
                        "status": getattr(run, "status", "unknown"),
                        "created_at": getattr(run, "created_at", None),
                        "report_url": getattr(run, "report_url", None),
                        "result_counts": None,
                    }
                    if hasattr(run, "result_counts") and run.result_counts:
                        run_data["result_counts"] = {
                            "total": getattr(run.result_counts, "total", 0),
                            "passed": getattr(run.result_counts, "passed", 0),
                            "failed": getattr(run.result_counts, "failed", 0),
                            "errored": getattr(run.result_counts, "errored", 0),
                        }
                    all_runs.append(run_data)
            except Exception as e:
                logger.warning("Failed to get runs for eval %s: %s", ev.id, e)

        # Merge red team runs from the local registry
        # (Foundry's evals.list() doesn't return red team evals — they're in a separate namespace)
        try:
            from app.routers.red_team import _red_team_runs
            for rt in _red_team_runs:
                rt_data = {
                    "id": rt["run_id"],
                    "eval_id": rt["eval_id"],
                    "eval_name": rt.get("name", "Red Team Scan"),
                    "type": "red_team",
                    "name": rt.get("name", "Red Team Scan"),
                    "status": rt.get("status", "unknown"),
                    "created_at": rt.get("created_at"),
                    "report_url": None,
                    "result_counts": None,
                }
                # Try to get fresh status
                try:
                    run = client.evals.runs.retrieve(run_id=rt["run_id"], eval_id=rt["eval_id"])
                    rt_data["status"] = getattr(run, "status", "unknown")
                    rt_data["report_url"] = getattr(run, "report_url", None)
                    if hasattr(run, "result_counts") and run.result_counts:
                        rt_data["result_counts"] = {
                            "total": getattr(run.result_counts, "total", 0),
                            "passed": getattr(run.result_counts, "passed", 0),
                            "failed": getattr(run.result_counts, "failed", 0),
                            "errored": getattr(run.result_counts, "errored", 0),
                        }
                except Exception as e:
                    logger.warning("Could not refresh red team run %s: %s", rt["run_id"], e)
                all_runs.append(rt_data)
        except Exception as e:
            logger.warning("Could not merge red team runs: %s", e)

        # Sort by created_at descending and limit
        all_runs.sort(key=lambda r: r.get("created_at") or 0, reverse=True)
        all_runs = all_runs[:limit]

        return {"runs": all_runs, "total": len(all_runs)}

    except Exception as e:
        logger.exception("Failed to list recent runs")
        raise HTTPException(500, str(e))
