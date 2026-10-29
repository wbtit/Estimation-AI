"""Session preparation: a fresh project for an estimator session (or the owner's dry run).

  PYTHONPATH=. .venv/bin/python -m tools.session_project (--pdf PATH | --from-project ID)
      --name=NAME [--purpose=real|demo] [--apply]

Without --apply: a dry run (nothing written): the PDF's SHA-256 and page count and the hash check.
With --apply: a new project (purpose real by default), the PDF copied into the upload directory,
then the same jobs as an upload (scan, auto run) run here for this project only; the auto run only
SUGGESTS each page's setup and builds nothing (pages are built when a person presses Build).

Hash check: the PDF is REFUSED when its SHA-256 is in the held-out TEST lock (any purpose). For
purpose real it is also refused when it matches a registered takeoff, a registered drawing that
can be read, or the PDF of any project already in the database (dev, evaluation and test copies),
so the session runs on a new bid. Prints ids, counts and hash prefixes only, never names.
"""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any

import pymupdf
from psycopg.types.json import Jsonb

from src.config import WorkerConfig, load_config
from src.db import connect
from src.main import HANDLERS
from src.queue import Job, complete_job

REPO = Path(__file__).resolve().parents[2]
PRIVATE = REPO / "fixtures" / "private"
LOCK = PRIVATE / "markups" / "heldout_test.lock"
TAKEOFF_MAP = PRIVATE / "takeoffs" / "PRIVATE_MAP.csv"
INVENTORY_MAP = PRIVATE / "inventory_map.csv"
PURPOSES = ("real", "demo")
STORED_NAME = "drawings.pdf"  # the original file name is not stored (it may hold a client name)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def lock_hashes(lock: Path = LOCK) -> dict[str, str]:
    """sha256 -> job id, drawings and markups of the held-out TEST set."""
    out: dict[str, str] = {}
    for job, v in json.loads(lock.read_text())["jobs"].items():
        for k in ("drawing_sha256", "markup_sha256"):
            if v.get(k):
                out[v[k]] = job
    return out


def _csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


def register_hashes() -> dict[str, str]:
    """sha256 -> a register id for registered takeoffs and readable registered drawings."""
    out = {r["sha256"]: "takeoff register" for r in _csv(TAKEOFF_MAP) if r.get("sha256")}
    for r in _csv(INVENTORY_MAP):
        p = PRIVATE / r.get("relative_path", "")
        if r.get("relative_path") and p.is_file():
            out[sha256(p)] = r.get("id", "inventory")
    return out


def check(
    digest: str,
    purpose: str,
    lock: dict[str, str],
    registers: dict[str, str],
    projects: dict[str, list[str]],
) -> dict[str, Any]:
    """Pure: the matches and whether the PDF is refused for this purpose."""
    found = {
        "heldout_lock": lock.get(digest),
        "registers": registers.get(digest),
        "existing_projects": sorted(projects.get(digest, [])),
    }
    why = []
    if found["heldout_lock"]:
        why.append(f"held-out TEST job {found['heldout_lock']}")
    if purpose == "real" and found["registers"]:
        why.append(f"registered file ({found['registers']})")
    if purpose == "real" and found["existing_projects"]:
        why.append(f"already the PDF of {len(found['existing_projects'])} project(s)")
    return {**found, "refused": bool(why), "why": why}


def _drain(conn, config: WorkerConfig, project_id: str) -> list[dict[str, Any]]:
    """Runs this project's queued jobs here, oldest first (scan, then the auto run it queues)."""
    done = []
    while True:
        row = conn.execute(
            "UPDATE jobs SET status = 'processing', locked_at = now(),"
            " locked_by = 'session_project', attempts = attempts + 1"
            " WHERE id = (SELECT id FROM jobs WHERE status = 'pending'"
            " AND payload->>'project_id' = %s ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)"
            " RETURNING id, type, payload, attempts, max_attempts",
            (project_id,),
        ).fetchone()
        conn.commit()
        if row is None:
            return done
        job = Job(str(row["id"]), row["type"], row["payload"], row["attempts"], row["max_attempts"])
        result = HANDLERS[job.type](conn, job, config)
        complete_job(conn, job.id, result)
        done.append({"type": job.type, "result_keys": sorted(result)[:8]})


def create(conn, config: WorkerConfig, pdf: Path, name: str, purpose: str, digest: str) -> dict:
    project_id = str(
        conn.execute(
            "INSERT INTO projects (name, status, design_standard, unit_system, stage, grids,"
            " levels, purpose) VALUES (%s, 'created', 'AISC', 'mm', 'Estimating', '[]', '[]', %s)"
            " RETURNING id",
            (name, purpose),
        ).fetchone()["id"]
    )
    relative = f"{project_id}/{uuid.uuid4()}.pdf"
    target = config.upload_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(pdf, target)
    if sha256(target) != digest:
        raise SystemExit("the copied PDF differs from the source")
    doc = conn.execute(
        "INSERT INTO project_files (project_id, original_filename, stored_path, sha256,"
        " size_bytes) VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (project_id, STORED_NAME, relative, digest, target.stat().st_size),
    ).fetchone()["id"]
    conn.execute(
        "INSERT INTO jobs (type, payload) VALUES ('scan_pdf', %s)",
        (Jsonb({"project_id": project_id, "document_id": str(doc), "auto_run": True}),),
    )
    conn.execute("UPDATE projects SET status = 'scanning' WHERE id = %s", (project_id,))
    conn.commit()
    jobs = _drain(conn, config, project_id)
    counts = conn.execute(
        "SELECT (SELECT count(*) FROM sheets WHERE project_id = %(p)s) AS pages,"
        " (SELECT count(*) FROM build_runs WHERE project_id = %(p)s) AS build_runs,"
        " (SELECT count(*) FROM members WHERE project_id = %(p)s) AS members,"
        " (SELECT count(*) FROM build_snapshots WHERE project_id = %(p)s) AS snapshots,"
        " (SELECT count(*) FROM count_actions WHERE project_id = %(p)s) AS actions,"
        " (SELECT count(*) FROM member_edits e JOIN members m ON m.id = e.member_id"
        "  WHERE m.project_id = %(p)s) AS edits,"
        " (SELECT count(*) FROM build_views v JOIN sheets s ON s.id = v.sheet_id"
        "  WHERE s.project_id = %(p)s AND v.role_name IS NOT NULL) AS pages_with_suggested_role",
        {"p": project_id},
    ).fetchone()
    return {"project_id": project_id, "jobs": jobs, "after": dict(counts)}


def main(argv: list[str]) -> None:
    opts = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
    flags = {a for a in argv if a.startswith("--") and "=" not in a}
    rest = [a for a in argv if not a.startswith("--")]
    purpose = opts.get("purpose", "real")
    if purpose not in PURPOSES or not opts.get("name") or len(rest) != 1:
        print(__doc__)
        raise SystemExit(2)
    config = load_config()
    conn = connect(config.database_url)
    if "--from-project" in flags:
        row = conn.execute(
            "SELECT stored_path FROM project_files WHERE project_id = %s", (rest[0],)
        ).fetchone()
        if row is None:
            raise SystemExit("that project has no PDF")
        pdf = config.upload_dir / row["stored_path"]
    elif "--pdf" in flags:
        pdf = Path(rest[0])
    else:
        print(__doc__)
        raise SystemExit(2)
    if not pdf.is_file():
        raise SystemExit("PDF not found")
    digest = sha256(pdf)
    with pymupdf.open(pdf) as doc:
        pages = doc.page_count
    projects: dict[str, list[str]] = {}
    for r in conn.execute("SELECT sha256, project_id FROM project_files"):
        projects.setdefault(r["sha256"], []).append(str(r["project_id"]))
    conn.rollback()
    res = check(digest, purpose, lock_hashes(), register_hashes(), projects)
    out = {
        "sha256": digest[:12] + "...",
        "pages": pages,
        "purpose": purpose,
        "hash_check": res,
        "applied": False,
    }
    if res["refused"]:
        print(json.dumps(out, indent=1))
        raise SystemExit("REFUSED: " + "; ".join(res["why"]))
    if "--apply" in flags:
        out.update(create(conn, config, pdf, opts["name"], purpose, digest), applied=True)
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main(sys.argv[1:])
