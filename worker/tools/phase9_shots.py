"""Phase 9: screenshots of the pilot switch, ranked snap with Tab, unlinked suggestions and the
sheet-number reading, on a SYNTHETIC drawing in a scratch database.

  PYTHONPATH=. .venv/bin/python -m tools.phase9_shots

Nothing real is touched: it creates the scratch database `<DATABASE_URL name>_phase9demo_test`
(the name must end in `_test`), applies the migrations to it, starts its own API (port 3200),
worker, web dev server (port 5273) and geckodriver (port 4444), and drives the real review screen
in a headless Firefox. PNGs go to fixtures/private/shots/phase9/. Every process it starts is
recorded in a pid file and stopped by its own handle (never by pattern); the API on port 3000 is
not used. Drops nothing.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
import pymupdf

from tools import phase8_shots as p8
from tools.takeoff.common import PRIVATE, ROOT

SHOTS = PRIVATE / "shots" / "phase9"
PIDFILE = Path(os.environ.get("PHASE9_PIDFILE", "/tmp/phase9_shots.pids"))
WHO = "demo"
TAB = ""


def demo_url() -> str:
    u = urlparse(p8.env_value("DATABASE_URL"))
    return urlunparse(u._replace(path="/" + u.path.lstrip("/") + "_phase9demo_test"))


def draw_plan(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=1200, height=800)
    xs, ys = [150, 450, 750, 950], [150, 350, 550]
    for y in ys:
        page.draw_line((xs[0], y), (xs[-1], y), width=2.0)  # heavy beam lines
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]), width=2.0)
    for k in range(10):  # plenty of thin line length (borders, notes, grid), as on a real sheet
        page.draw_line((40, 620 + 9 * k), (1160, 620 + 9 * k), width=0.25)
    page.draw_line((xs[0], 354), (xs[-1], 354), width=0.25)  # a thin line right beside a beam
    # a dimension line: diagonal ticks at both ends and its number
    page.draw_line((xs[0], 100), (xs[-1], 100), width=0.25)
    for x in (xs[0], xs[-1]):
        page.draw_line((x - 2, 102), (x + 2, 98), width=0.25)
    page.insert_text((520, 94), "26'-8\"", fontsize=8)
    for k in range(24):  # a hatch patch (dense, 1.5 pt apart)
        page.draw_line((820, 420 + 1.5 * k), (900, 420 + 1.5 * k), width=0.1)
    page.insert_text((250, 143), "W16x31", fontsize=8)  # a beam with its label
    page.insert_text((620, 463), "W8x10", fontsize=8)  # a label with no line near it
    page.insert_text((70, 760), 'SCALE: 1/8" = 1\'-0"', fontsize=9)
    page.insert_text((1010, 640), "S4", fontsize=26)  # a big detail mark in the corner
    page.insert_text((930, 700), "DRAWING NUMBER", fontsize=7)
    page.insert_text((1030, 722), "S4-01", fontsize=16)  # the real sheet number, right-aligned cell
    for i, small in enumerate(("DATE", "DRAWN", "CHECKED")):
        page.insert_text((930, 740 + i * 9), small, fontsize=6)
    doc.save(path)


def key(driver: p8.Driver, value: str) -> None:
    p8.call(
        "POST",
        driver.s + "/actions",
        {
            "actions": [
                {
                    "type": "key",
                    "id": "kb",
                    "actions": [
                        {"type": "keyDown", "value": value},
                        {"type": "keyUp", "value": value},
                    ],
                }
            ]
        },
    )
    time.sleep(0.5)


def main() -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    p8.SHOTS = SHOTS
    url = demo_url()
    admin = urlparse(url)._replace(path="/postgres")
    name = urlparse(url).path.lstrip("/")
    assert name.endswith("_test")
    with psycopg.connect(urlunparse(admin), autocommit=True) as c:
        if not c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            c.execute(f'CREATE DATABASE "{name}"')
    env = {**os.environ, "DATABASE_URL": url, "NODE_ENV": "development"}
    uploads = Path("/tmp/phase9_demo_uploads")
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
            stdout=open(f"/tmp/phase9_{log}.log", "w"),
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

        pdf = Path("/tmp/phase9_demo_plan.pdf")
        draw_plan(pdf)
        proj = p8.api("POST", "/api/projects", {"name": "synthetic framing plan"})
        boundary = "----p9" + uuid.uuid4().hex
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
            f"/api/projects/{proj['id']}/pdf",
            raw=body,
            headers={"content-type": f"multipart/form-data; boundary={boundary}"},
        )
        pid = proj["id"]
        for _ in range(240):
            fl = p8.api("GET", f"/api/projects/{pid}/flags")
            last = fl.get("last_run")
            if last and last["status"] in ("done", "completed", "failed"):
                break
            time.sleep(1)
        sheets = p8.api("GET", f"/api/projects/{pid}/sheets")["sheets"]
        print(
            "sheet number read:",
            sheets[0]["sheet_number"],
            "flag:",
            sheets[0].get("sheet_number_flag"),
            "earlier:",
            sheets[0].get("sheet_number_old"),
            flush=True,
        )
        # the snap needs the page's lines (the worker job); ask for them now
        sid = sheets[0]["id"]
        for _ in range(60):
            r = p8.call(
                "POST",
                f"http://127.0.0.1:{p8.API_PORT}/api/projects/{pid}/sheets/{sid}/lines/prepare",
                {},
            )
            if r.get("status") == "ready":
                break
            time.sleep(1)
        lines = p8.api("GET", f"/api/projects/{pid}/sheets/{sid}/lines")
        roles = {}
        for row in lines["lines"]:
            roles[(row[6], row[7])] = roles.get((row[6], row[7]), 0) + 1
        print("lines by (role, dimension):", dict(sorted(roles.items())), flush=True)

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
        print("tabs with the pilot off:", tabs, flush=True)
        driver.shot("01-pilot-off-no-count-tab.png")

        # switch the pilot on: the browser asks first
        driver.js("window.confirm = () => true")  # the confirm() of the switch (answered yes)
        driver.click("input[role=switch]")
        time.sleep(1.5)
        tabs = driver.js(
            "return [...document.querySelectorAll('button[role=tab]')].map(b=>b.textContent)"
        )
        print("tabs with the pilot on:", tabs, flush=True)
        driver.js(
            "[...document.querySelectorAll('button[role=tab]')].find(b=>b.textContent==='count').click()"
        )
        driver.wait_for("[data-testid=count-panel]")
        time.sleep(1)
        driver.shot("02-pilot-on-unlinked-suggestion.png")

        driver.click("[data-testid=tool-count]")
        for _ in range(60):
            if "lines ready" in driver.text("[data-testid=lines-state]"):
                break
            time.sleep(1)
        driver.move(300, 352)  # beam (heavy) and a thin line 4 pt away
        driver.wait_for("[data-testid=snap-line]")
        driver.shot("03-ranked-snap-heavy-first.png")
        key(driver, TAB)
        driver.shot("04-tab-next-line.png")
        driver.click_at(300, 352)
        time.sleep(1)
        driver.shot("05-click-on-the-line-tab-chose.png")
        driver.move(860, 437)  # inside the hatch patch: nothing to snap to
        time.sleep(0.6)
        snap_in_hatch = driver.find("[data-testid=snap-line]")
        print("snap line shown inside hatch:", bool(snap_in_hatch), flush=True)
        driver.shot("06-hatch-never-snaps.png")

        # accept the unlinked label: one click on its dashed amber square
        sq = driver.js(
            "const e=document.querySelector('[data-testid=unlinked-suggestion]');"
            "if(!e) return null; const r=e.getBoundingClientRect();"
            "return [r.left+r.width/2,r.top+r.height/2]"
        )
        print("unlinked suggestion square present:", bool(sq), flush=True)
        if sq:
            driver.actions(
                [
                    {
                        "type": "pointerMove",
                        "duration": 50,
                        "origin": "viewport",
                        "x": round(sq[0]),
                        "y": round(sq[1]),
                    },
                    {"type": "pointerDown", "button": 0},
                    {"type": "pointerUp", "button": 0},
                ]
            )
            time.sleep(1.2)
        driver.shot("07-unlinked-suggestion-accepted.png")
        log = p8.api("GET", f"/api/projects/{pid}/count-actions")
        click_rows = [a for a in log["actions"] if a["action"] == "create"]
        print(
            "create rows:",
            len(click_rows),
            "snap_by:",
            [a["detail"].get("snap_by") for a in click_rows],
            "rank:",
            [a["detail"].get("snap_rank") for a in click_rows],
            flush=True,
        )
        t = p8.api("GET", f"/api/projects/{pid}/takeoff")
        print(
            "takeoff:",
            json.dumps(
                {
                    "count_mode": t["count_mode"],
                    "pieces": t["totals"]["pieces"],
                    "suggested_pieces": t["suggested"]["totals"]["pieces"],
                    "unlinked": t["unlinked_labels"],
                }
            ),
            flush=True,
        )
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
