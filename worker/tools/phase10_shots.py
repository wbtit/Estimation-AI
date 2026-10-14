"""Phase 10: the typical editor, the weight line and the pilot report in a real browser, on a
SYNTHETIC drawing in a scratch database `<DATABASE_URL name>_phase10demo_test` (dropped by the
operator afterwards). Same harness as tools/phase9_shots.py: own API (3200), worker, web (5273) and
geckodriver (4444), every process recorded in a pid file and stopped by its own handle; the API on
port 3000 is not used. PNGs go to fixtures/private/shots/phase10/.

  PYTHONPATH=. .venv/bin/python -m tools.phase10_shots
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg

from tools import phase8_shots as p8
from tools import phase9_shots as p9
from tools.takeoff.common import PRIVATE, ROOT

SHOTS = PRIVATE / "shots" / "phase10"
PIDFILE = Path("/tmp/phase10_shots.pids")
WHO = "demo"


def main() -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    p8.SHOTS = SHOTS
    u = urlparse(p8.env_value("DATABASE_URL"))
    url = urlunparse(u._replace(path="/" + u.path.lstrip("/") + "_phase10demo_test"))
    name = urlparse(url).path.lstrip("/")
    assert name.endswith("_test")
    with psycopg.connect(urlunparse(u._replace(path="/postgres")), autocommit=True) as c:
        if not c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            c.execute(f'CREATE DATABASE "{name}"')
    env = {**os.environ, "DATABASE_URL": url, "NODE_ENV": "development"}
    uploads = Path("/tmp/phase10_demo_uploads")
    uploads.mkdir(exist_ok=True)
    env["UPLOAD_DIR"] = str(uploads)
    subprocess.run(
        ["npx", "tsx", "db/migrate.ts"], cwd=ROOT, env=env, check=True, capture_output=True
    )
    procs: list[subprocess.Popen] = []

    def start(cmd, cwd, extra=None, log="proc"):
        p = subprocess.Popen(
            cmd,
            cwd=cwd,
            env={**env, **(extra or {})},
            stdout=open(f"/tmp/phase10_{log}.log", "w"),
            stderr=subprocess.STDOUT,
        )
        procs.append(p)
        PIDFILE.write_text("\n".join(str(x.pid) for x in procs))
        return p

    driver = None
    try:
        start(
            ["node", "--import", "tsx", "src/server.ts"],
            ROOT / "api",
            {"PORT": str(p8.API_PORT)},
            "api",
        )
        start(
            [str(ROOT / "worker/.venv/bin/python"), "-m", "src.main"],
            ROOT / "worker",
            {"PYTHONPATH": "."},
            "worker",
        )
        vite = ROOT / "web/node_modules/vite/bin/vite.js"
        start(
            ["node", str(vite), "--port", str(p8.WEB_PORT), "--strictPort"],
            ROOT / "web",
            {"API_PROXY": f"http://127.0.0.1:{p8.API_PORT}"},
            "web",
        )
        start(["geckodriver", "--port", str(p8.DRIVER_PORT)], ROOT, None, "gecko")
        p8.wait_http(f"http://127.0.0.1:{p8.API_PORT}/api/projects")
        p8.wait_http(f"http://127.0.0.1:{p8.WEB_PORT}/")
        p8.wait_http(f"http://127.0.0.1:{p8.DRIVER_PORT}/status")

        pdf = Path("/tmp/phase10_demo_plan.pdf")
        p9.draw_plan(pdf)
        proj = p8.api("POST", "/api/projects", {"name": "synthetic framing plan"})
        pid = proj["id"]
        boundary = "----p10" + uuid.uuid4().hex
        body = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file";'
                ' filename="plan.pdf"\r\nContent-Type: application/pdf\r\n\r\n'
            ).encode()
            + pdf.read_bytes()
            + f"\r\n--{boundary}--\r\n".encode()
        )
        p8.api(
            "POST",
            f"/api/projects/{pid}/pdf",
            raw=body,
            headers={"content-type": f"multipart/form-data; boundary={boundary}"},
        )
        for _ in range(240):
            last = p8.api("GET", f"/api/projects/{pid}/flags").get("last_run")
            if last and last["status"] in ("done", "completed", "failed"):
                break
            time.sleep(1)
        sid = p8.api("GET", f"/api/projects/{pid}/sheets")["sheets"][0]["id"]
        p8.api("PUT", f"/api/projects/{pid}/count", {"who": WHO, "count_mode": True})
        clicks = []
        for x in (300, 600):
            r = p8.api(
                "POST",
                f"/api/projects/{pid}/count/click",
                {"who": WHO, "sheet_id": sid, "kind": "Beams", "x": x, "y": 350},
            )
            clicks.append(r["member"]["id"])
        p8.api(
            "POST",
            f"/api/projects/{pid}/members/{clicks[0]}/typical",
            {"who": WHO, "n": 6, "note": "six bays per the typical note"},
        )

        driver = p8.Driver()
        site = f"http://127.0.0.1:{p8.WEB_PORT}/"
        driver.get(site)
        driver.js("localStorage.setItem('review.who', arguments[0])", WHO)
        driver.get(f"{site}#p={pid}&s=1")
        driver.js("location.reload()")
        driver.wait_for("svg.page-overlay")
        time.sleep(2.5)
        tabs = driver.js(
            "return [...document.querySelectorAll('button[role=tab]')].map(b=>b.textContent)"
        )
        print("tabs:", tabs, flush=True)
        driver.js(
            "[...document.querySelectorAll('button[role=tab]')].find(b=>b.textContent==='count').click()"
        )
        driver.wait_for("[data-testid=count-panel]")
        driver.js(
            "[...document.querySelectorAll('[data-testid=confirmed-list] li')]"
            ".find(li=>li.textContent.includes('typical'))?.querySelector('.kind').click()"
        )
        time.sleep(1)
        print("typical badge:", driver.text("[data-testid=typical-badge]"), flush=True)
        print(
            "typical editor shown:", bool(driver.find("[data-testid=typical-editor]")), flush=True
        )
        print("prefix setting shown:", bool(driver.find("[data-testid=prefix-kinds]")), flush=True)
        driver.shot("01-typical-badge-and-editor.png")
        driver.js(
            "[...document.querySelectorAll('button[role=tab]')].find(b=>b.textContent==='tables').click()"
        )
        time.sleep(2)
        print(
            "weight lines:",
            driver.js(
                "return [...document.querySelectorAll('[data-testid=weight-total]')]"
                ".map(e=>e.textContent)"
            ),
            flush=True,
        )
        driver.shot("02-tables-weight-and-no-length.png")
        driver.js(
            "[...document.querySelectorAll('button[role=tab]')].find(b=>b.textContent==='report').click()"
        )
        driver.wait_for("[data-testid=pilot-report]")
        time.sleep(1)
        print("report total:", driver.text("[data-testid=pilot-report-total]"), flush=True)
        driver.shot("03-pilot-report.png")
    finally:
        if driver:
            driver.quit()
        for p in reversed(procs):
            p.terminate()
        for p in procs:
            try:
                p.wait(timeout=15)
            except subprocess.TimeoutExpired:
                p.kill()
        PIDFILE.write_text("")


if __name__ == "__main__":
    sys.exit(main())
