"""Background poller — periodically refreshes non-terminal eval runs from Foundry
and writes the latest status / metrics back to Cosmos.

Designed to run as a FastAPI lifespan task. Tolerant to transient Foundry or
Cosmos errors — each loop swallows exceptions and retries on the next tick.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from app.config import get_openai_client
from app.cosmos_repo import safe_get_cosmos_repo, TERMINAL_STATUSES

logger = logging.getLogger("app.poller")

# Default cadence — overridable via env on the Container App.
POLL_INTERVAL_SECONDS = int(os.environ.get("EVAL_POLLER_INTERVAL", "30"))
MAX_RUNS_PER_TICK = int(os.environ.get("EVAL_POLLER_BATCH", "100"))


def _extract_run_snapshot(run: Any) -> dict:
    """Normalize a Foundry run object into a plain dict for Cosmos."""
    snapshot: dict = {
        "status": getattr(run, "status", "unknown"),
        "report_url": getattr(run, "report_url", None),
        "result_counts": None,
        "metrics": None,
        "error": None,
    }

    rc = getattr(run, "result_counts", None)
    if rc is not None:
        snapshot["result_counts"] = {
            "total": getattr(rc, "total", 0) or 0,
            "passed": getattr(rc, "passed", 0) or 0,
            "failed": getattr(rc, "failed", 0) or 0,
            "errored": getattr(rc, "errored", 0) or 0,
        }

    per_eval = getattr(run, "per_testing_criteria_results", None)
    if per_eval:
        snapshot["metrics"] = [
            {
                "name": getattr(r, "testing_criteria", str(r)),
                "passed": getattr(r, "passed", 0) or 0,
                "failed": getattr(r, "failed", 0) or 0,
                "pass_rate": getattr(r, "pass_rate", 0) or 0,
            }
            for r in per_eval
        ]

    err = getattr(run, "error", None)
    if err is not None:
        snapshot["error"] = str(err)

    return snapshot


def _refresh_one(repo, client, doc: dict) -> None:
    eval_id = doc.get("evalId")
    run_id = doc.get("runId") or doc.get("id")
    if not eval_id or not run_id:
        return

    try:
        run = client.evals.runs.retrieve(run_id=run_id, eval_id=eval_id)
    except Exception as e:
        # 404 means the run was deleted upstream — mark as failed so we stop polling.
        msg = str(e).lower()
        if "not found" in msg or "404" in msg:
            repo.update_from_foundry(
                eval_id=eval_id,
                run_id=run_id,
                status="failed",
                error="Run no longer exists in Foundry",
            )
            return
        logger.warning("Foundry retrieve failed for run %s: %s", run_id, e)
        return

    snap = _extract_run_snapshot(run)
    try:
        repo.update_from_foundry(
            eval_id=eval_id,
            run_id=run_id,
            status=snap["status"],
            result_counts=snap["result_counts"],
            metrics=snap["metrics"],
            report_url=snap["report_url"],
            error=snap["error"],
        )
    except Exception as e:
        logger.warning("Cosmos update failed for run %s: %s", run_id, e)


async def poller_loop() -> None:
    """Forever loop — sleeps `POLL_INTERVAL_SECONDS` between ticks."""
    logger.info(
        "Eval poller starting (interval=%ds, batch=%d)",
        POLL_INTERVAL_SECONDS,
        MAX_RUNS_PER_TICK,
    )
    while True:
        try:
            repo = safe_get_cosmos_repo()
            if repo is None:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue

            pending = repo.list_pending(max_items=MAX_RUNS_PER_TICK)
            if pending:
                logger.info("Poller tick: refreshing %d pending runs", len(pending))
                client = get_openai_client()
                # Refresh sequentially — Foundry SDK is sync, low volume expected.
                for doc in pending:
                    if doc.get("status") in TERMINAL_STATUSES:
                        continue
                    _refresh_one(repo, client, doc)

        except asyncio.CancelledError:
            logger.info("Eval poller cancelled")
            raise
        except Exception as e:  # pragma: no cover
            logger.exception("Poller tick failed: %s", e)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)
