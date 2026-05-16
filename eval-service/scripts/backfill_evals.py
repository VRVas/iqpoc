"""One-shot backfill: pull every historical eval + run from Foundry and upsert
into Cosmos so the new Cosmos-backed history view shows pre-existing data.

Idempotent — re-running will refresh existing docs with the latest status.

Usage (from inside the running ca-eval-svc-v2 container OR a workstation with
the AZURE_CLIENT_ID env var pointing at the eval-service UAMI):

    python -m scripts.backfill_evals
    python -m scripts.backfill_evals --max-evals 500

Refs:
  - https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#get-results
  - https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/quickstart-python
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from typing import Optional

from app.config import get_openai_client
from app.cosmos_repo import get_cosmos_repo

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill")


def _classify_category(eval_name: str) -> tuple[str, str]:
    """Best-effort: derive (type, category) from a historical eval name."""
    name_lower = (eval_name or "").lower()
    if "red team" in name_lower or "redteam" in name_lower:
        return "red_team", "red_team"
    if "continuous" in name_lower:
        return "continuous", "continuous"
    if "agent" in name_lower:
        return "evaluation", "agent_target"
    if "synthetic" in name_lower:
        return "evaluation", "synthetic"
    if "model" in name_lower:
        return "evaluation", "model_target"
    return "evaluation", "batch"


def _normalize_status(run) -> str:
    status = getattr(run, "status", None) or "unknown"
    return str(status).lower()


def _extract_result_counts(run) -> Optional[dict]:
    rc = getattr(run, "result_counts", None)
    if not rc:
        return None
    return {
        "total": getattr(rc, "total", 0) or 0,
        "passed": getattr(rc, "passed", 0) or 0,
        "failed": getattr(rc, "failed", 0) or 0,
        "errored": getattr(rc, "errored", 0) or 0,
    }


def _extract_metrics(run) -> Optional[list[dict]]:
    per_eval = getattr(run, "per_testing_criteria_results", None)
    if not per_eval:
        return None
    return [
        {
            "name": getattr(r, "testing_criteria", str(r)),
            "passed": getattr(r, "passed", 0) or 0,
            "failed": getattr(r, "failed", 0) or 0,
            "pass_rate": getattr(r, "pass_rate", 0) or 0,
        }
        for r in per_eval
    ]


def backfill(max_evals: int = 1000, max_runs_per_eval: int = 50) -> tuple[int, int]:
    """Walk every eval and its runs, upserting into Cosmos.

    Returns (evals_seen, runs_upserted).
    """
    client = get_openai_client()
    repo = get_cosmos_repo()

    evals_seen = 0
    runs_upserted = 0

    # Paginate evals — `after` cursor pattern matches OpenAI/Foundry list APIs.
    after: Optional[str] = None
    page_size = 100
    while evals_seen < max_evals:
        kwargs = {"limit": min(page_size, max_evals - evals_seen), "order": "desc"}
        if after:
            kwargs["after"] = after
        evals_page = client.evals.list(**kwargs)
        eval_items = list(evals_page.data)
        if not eval_items:
            break

        for ev in eval_items:
            evals_seen += 1
            eval_id = getattr(ev, "id", None)
            eval_name = getattr(ev, "name", "") or ""
            if not eval_id:
                continue

            type_, category = _classify_category(eval_name)
            eval_created = getattr(ev, "created_at", None)

            try:
                runs_page = client.evals.runs.list(
                    eval_id=eval_id, limit=max_runs_per_eval, order="desc"
                )
            except Exception as e:
                logger.warning("Cannot list runs for eval %s: %s", eval_id, e)
                continue

            for run in runs_page.data:
                run_id = getattr(run, "id", None)
                if not run_id:
                    continue

                status = _normalize_status(run)
                run_created = getattr(run, "created_at", None) or eval_created or int(time.time())

                try:
                    repo.upsert_eval(
                        eval_id=eval_id,
                        run_id=run_id,
                        type=type_,
                        category=category,
                        name=getattr(run, "name", "") or eval_name,
                        status=status,
                        created_at=int(run_created) if run_created else None,
                    )
                    # Then push metrics into the doc
                    repo.update_from_foundry(
                        eval_id=eval_id,
                        run_id=run_id,
                        status=status,
                        result_counts=_extract_result_counts(run),
                        metrics=_extract_metrics(run),
                        report_url=getattr(run, "report_url", None),
                        error=str(getattr(run, "error", None)) if getattr(run, "error", None) else None,
                    )
                    runs_upserted += 1
                except Exception as e:
                    logger.warning("Upsert failed for run %s: %s", run_id, e)

            after = eval_id

        # Stop if the page came back short — no more pages.
        if len(eval_items) < page_size:
            break

    return evals_seen, runs_upserted


def main() -> int:
    p = argparse.ArgumentParser(description="Backfill historical evals into Cosmos")
    p.add_argument("--max-evals", type=int, default=1000)
    p.add_argument("--max-runs-per-eval", type=int, default=50)
    args = p.parse_args()

    logger.info(
        "Starting backfill (max_evals=%d, max_runs_per_eval=%d)",
        args.max_evals, args.max_runs_per_eval,
    )
    start = time.time()
    evals_seen, runs_upserted = backfill(
        max_evals=args.max_evals,
        max_runs_per_eval=args.max_runs_per_eval,
    )
    elapsed = time.time() - start
    logger.info(
        "Backfill complete: %d evals seen, %d runs upserted in %.1fs",
        evals_seen, runs_upserted, elapsed,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
