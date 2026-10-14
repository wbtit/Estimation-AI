"""Phase 8: screenshots of the counting copilot on a SYNTHETIC drawing, in a scratch database.

  PYTHONPATH=. .venv/bin/python -m tools.phase8_shots

Nothing real is touched: it creates the scratch database `<DATABASE_URL name>_phase8demo_test`
(the name must end in `_test`), applies the migrations to it, starts its own API (port 3200),
worker, web dev server (port 5273) and geckodriver (port 4444), draws a made-up framing plan,
drives the real review screen with a headless Firefox (hover, clicks, accept, reject, measure,
attach) and saves PNGs to
fixtures/private/shots/phase8/. Every process it starts is recorded in a pid file and stopped by its
own handle (never by pattern); the API on port 3000 is not used. Drops nothing.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
import pymupdf

from tools.takeoff.common import PRIVATE, ROOT

SHOTS = PRIVATE / "shots" / "phase8"
API_PORT, WEB_PORT, DRIVER_PORT = 3200, 5273, 4444
PIDFILE = Path(os.environ.get("PHASE8_PIDFILE", "/tmp/phase8_shots.pids"))
WHO = "demo"


def env_value(key: str) -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"{key} is not in .env")


def demo_url() -> str:
    u = urlparse(env_value("DATABASE_URL"))
    name = u.path.lstrip("/") + "_phase8demo_test"
    return urlunparse(u._replace(path="/" + name))


# ---- the made-up drawing -----------------------------------------------------------
def draw_plan(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=1200, height=800)
    xs, ys = [150, 450, 750, 950], [150, 350, 550]
    for y in ys:  # heavy beam lines, one drawn line each
        page.draw_line((xs[0], y), (xs[-1], y), width=2.0)
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]), width=2.0)
    for x in xs:  # columns
        for y in ys:
            page.draw_rect(
                pymupdf.Rect(x - 6, y - 6, x + 6, y + 6), color=(0, 0, 0), fill=(0, 0, 0)
            )
    # thin lines of other classes (dimension line with ticks, a leader, a hatch patch)
    page.draw_line((xs[0], 100), (xs[-1], 100), width=0.25)
    for x in xs:
        page.draw_line((x, 94), (x, 106), width=0.25)
    page.draw_line((300, 450), (380, 520), width=0.5)
    for k in range(10):
        page.draw_line((820, 420 + 4 * k), (900, 420 + 4 * k), width=0.1)
    # labels (text): two beams are labelled, the rest are not (the estimator counts those by click)
    page.insert_text((250, 143), "W16x31", fontsize=8)
    page.insert_text((560, 343), "W12x26", fontsize=8)
    page.insert_text((830, 543), "HSS8x4x1/2", fontsize=8)
    page.insert_text((456, 250), "W14x30", fontsize=8)
    page.insert_text((620, 463), "W8x10", fontsize=8)  # a label in open space: no line near it
    page.insert_text((70, 760), 'SCALE: 1/8" = 1\'-0"', fontsize=9)
    page.insert_text((880, 700), "SHEET NO.", fontsize=7)
    page.insert_text((880, 730), "S4.1", fontsize=24)
    page.insert_text((520, 710), "SHEET TITLE", fontsize=7)
    page.insert_text((520, 730), "SECOND FLOOR FRAMING PLAN", fontsize=12)
    doc.save(path)


# ---- small http helpers ------------------------------------------------------------
def call(method: str, url: str, body: object | None = None, raw: bytes | None = None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = dict(headers or {})
    if body is not None:
        h["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url} -> {e.code} {e.read().decode()[:200]}") from None
    return json.loads(text) if text else None


def api(method: str, path: str, body: object | None = None, **kw):
    return call(method, f"http://127.0.0.1:{API_PORT}{path}", body, **kw)


def wait_http(url: str, seconds: int = 60) -> None:
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return
        except urllib.error.HTTPError:
            return
        except Exception:  # noqa: BLE001 - not up yet
            time.sleep(0.5)
    raise RuntimeError(f"{url} did not come up")


class Driver:
    """The few WebDriver calls this script needs (geckodriver over http)."""

    def __init__(self) -> None:
        self.base = f"http://127.0.0.1:{DRIVER_PORT}"
        caps = {
            "capabilities": {
                "alwaysMatch": {
                    "browserName": "firefox",
                    "moz:firefoxOptions": {"args": ["-headless"]},
                    "timeouts": {"implicit": 0},
                }
            }
        }
        self.sid = call("POST", self.base + "/session", caps)["value"]["sessionId"]
        self.s = f"{self.base}/session/{self.sid}"
        call("POST", self.s + "/window/rect", {"width": 1700, "height": 1050})

    def get(self, url: str) -> None:
        call("POST", self.s + "/url", {"url": url})

    def js(self, script: str, *args):
        return call("POST", self.s + "/execute/sync", {"script": script, "args": list(args)})[
            "value"
        ]

    def find(self, css: str) -> str | None:
        try:
            v = call("POST", self.s + "/element", {"using": "css selector", "value": css})["value"]
        except RuntimeError:
            return None
        return next(iter(v.values()))

    def wait_for(self, css: str, seconds: int = 30) -> str:
        end = time.time() + seconds
        while time.time() < end:
            el = self.find(css)
            if el:
                return el
            time.sleep(0.4)
        raise RuntimeError(f"element {css} not found")

    def click(self, css: str) -> None:
        el = self.wait_for(css)
        call("POST", f"{self.s}/element/{el}/click", {})

    def text(self, css: str) -> str:
        el = self.wait_for(css)
        return call("GET", f"{self.s}/element/{el}/text")["value"]

    def select(self, css: str, value: str) -> None:
        self.js(
            "const e=document.querySelector(arguments[0]);"
            "const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;"
            "set.call(e,arguments[1]);e.dispatchEvent(new Event('change',{bubbles:true}));",
            css,
            value,
        )

    def page_xy(self, x_pt: float, y_pt: float) -> tuple[int, int]:
        """Viewport pixels of a point in page points (the overlay is 1200 x 800 points)."""
        r = self.js(
            "const r=document.querySelector('svg.page-overlay').getBoundingClientRect();"
            "return [r.left, r.top, r.width, r.height];"
        )
        return round(r[0] + x_pt * r[2] / 1200), round(r[1] + y_pt * r[3] / 800)

    def actions(self, steps: list[dict]) -> None:
        call(
            "POST",
            self.s + "/actions",
            {
                "actions": [
                    {
                        "type": "pointer",
                        "id": "mouse",
                        "parameters": {"pointerType": "mouse"},
                        "actions": steps,
                    }
                ]
            },
        )

    def move(self, x_pt: float, y_pt: float) -> None:
        x, y = self.page_xy(x_pt, y_pt)
        self.actions(
            [{"type": "pointerMove", "duration": 60, "origin": "viewport", "x": x, "y": y}]
        )
        time.sleep(0.4)

    def click_at(self, x_pt: float, y_pt: float, shift: bool = False) -> None:
        x, y = self.page_xy(x_pt, y_pt)
        self.actions(
            [
                {"type": "pointerMove", "duration": 60, "origin": "viewport", "x": x, "y": y},
                {"type": "pointerDown", "button": 0},
                {"type": "pointerUp", "button": 0},
            ]
        )
        time.sleep(0.8)

    def shot(self, name: str) -> Path:
        png = call("GET", self.s + "/screenshot")["value"]
        path = SHOTS / name
        path.write_bytes(base64.b64decode(png))
        print("saved", path.name, flush=True)
        return path

    def quit(self) -> None:
        try:
            call("DELETE", self.s, None)
        except Exception:  # noqa: BLE001
            pass


def main() -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    url = demo_url()
    admin = urlparse(url)._replace(path="/postgres")
    name = urlparse(url).path.lstrip("/")
    assert name.endswith("_test")
    with psycopg.connect(urlunparse(admin), autocommit=True) as c:
        if not c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            c.execute(f'CREATE DATABASE "{name}"')
    env = {**os.environ, "DATABASE_URL": url, "NODE_ENV": "development"}
    uploads = Path("/tmp/phase8_demo_uploads")
    uploads.mkdir(exist_ok=True)
    env["UPLOAD_DIR"] = str(uploads)
    subprocess.run(
        ["npx", "tsx", "db/migrate.ts"], cwd=ROOT, env=env, check=True, capture_output=True
    )
    procs: list[subprocess.Popen] = []

    def start(
        cmd: list[str], cwd: Path, extra: dict | None = None, log: str = "proc"
    ) -> subprocess.Popen:
        p = subprocess.Popen(
            cmd,
            cwd=cwd,
            env={**env, **(extra or {})},
            stdout=open(f"/tmp/phase8_{log}.log", "w"),
            stderr=subprocess.STDOUT,
        )
        procs.append(p)
        PIDFILE.write_text("\n".join(str(x.pid) for x in procs))
        return p

    driver: Driver | None = None
    try:
        start(
            ["node", "--import", "tsx", "src/server.ts"],
            ROOT / "api",
            {"PORT": str(API_PORT)},
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
            ["node", str(vite), "--port", str(WEB_PORT), "--strictPort"],
            ROOT / "web",
            {"API_PROXY": f"http://127.0.0.1:{API_PORT}"},
            "web",
        )
        start(["geckodriver", "--port", str(DRIVER_PORT)], ROOT, None, "gecko")
        wait_http(f"http://127.0.0.1:{API_PORT}/api/projects")
        wait_http(f"http://127.0.0.1:{WEB_PORT}/")
        wait_http(f"http://127.0.0.1:{DRIVER_PORT}/status")

        # the made-up drawing, uploaded like a person would
        pdf = Path("/tmp/phase8_demo_plan.pdf")
        draw_plan(pdf)
        proj = api("POST", "/api/projects", {"name": "synthetic framing plan"})
        boundary = "----p8" + uuid.uuid4().hex
        body = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file";'
                ' filename="plan.pdf"\r\n'
                "Content-Type: application/pdf\r\n\r\n"
            ).encode()
            + pdf.read_bytes()
            + f"\r\n--{boundary}--\r\n".encode()
        )
        api(
            "POST",
            f"/api/projects/{proj['id']}/pdf",
            raw=body,
            headers={"content-type": f"multipart/form-data; boundary={boundary}"},
        )
        pid = proj["id"]
        for _ in range(240):
            fl = api("GET", f"/api/projects/{pid}/flags")
            last = fl.get("last_run")
            if last and last["status"] in ("done", "completed", "failed"):
                break
            time.sleep(1)
        print("pipeline", fl.get("last_run") and fl["last_run"]["status"], flush=True)
        members = api("GET", f"/api/projects/{pid}/members")["members"]
        print("system members:", len(members), flush=True)
        api("PUT", f"/api/projects/{pid}/count", {"who": WHO, "count_mode": True})

        driver = Driver()
        site = f"http://127.0.0.1:{WEB_PORT}/"
        driver.get(site)
        driver.js("localStorage.setItem('review.who', arguments[0])", WHO)
        driver.get(f"{site}#p={pid}&s=1")
        driver.js("location.reload()")
        driver.wait_for("svg.page-overlay")
        time.sleep(2.5)  # the page canvas renders
        driver.click("button[role=tab]:nth-of-type(7)")  # the "count" tab
        driver.wait_for("[data-testid=count-panel]")
        driver.shot("01-suggestions-dashed.png")

        # count tool: the line under the pointer is highlighted before the click
        driver.click("[data-testid=tool-count]")
        for _ in range(60):
            if "lines ready" in driver.text("[data-testid=lines-state]"):
                break
            time.sleep(1)
        driver.move(300, 156)
        driver.wait_for("[data-testid=snap-line]")
        driver.shot("02-count-hover-snap.png")

        # three clicks: an unlabelled beam, a column, and one far from everything (blank size)
        driver.click_at(150, 250)  # vertical beam, no label linked to it
        driver.select("select[aria-label='kind to count']", "Column")
        driver.click_at(750, 150)  # a column
        driver.select("select[aria-label='kind to count']", "Beams")
        driver.click_at(1010, 700)  # nothing near: blank, amber
        time.sleep(1)
        driver.shot("03-clicks-with-size-notes.png")

        # accept one suggestion with a click on its symbol, reject another with shift-click
        sugg = driver.js(
            "return [...document.querySelectorAll("
            "'[data-testid=count-symbol][data-state=suggested]')]"
            ".map(e=>{const r=e.getBoundingClientRect();"
            "return [r.left+r.width/2,r.top+r.height/2]})"
        )
        if sugg:
            driver.actions(
                [
                    {
                        "type": "pointerMove",
                        "duration": 50,
                        "origin": "viewport",
                        "x": round(sugg[0][0]),
                        "y": round(sugg[0][1]),
                    },
                    {"type": "pointerDown", "button": 0},
                    {"type": "pointerUp", "button": 0},
                ]
            )
            time.sleep(1)
        if len(sugg) > 1:
            driver.click("[data-testid=reject]")
            time.sleep(1)
        driver.shot("04-accept-reject.png")

        # measure needs the page's CONFIRMED scale: confirm the guesses like a person would
        driver.js(
            "[...document.querySelectorAll('button')]"
            ".find(b=>b.textContent.includes('These guesses are right'))?.click()"
        )
        time.sleep(2)
        # measure: two clicks, snapped, shown before the second click is confirmed
        driver.click("[data-testid=tool-measure]")
        driver.move(154, 154)
        driver.wait_for("[data-testid=snap-endpoint], [data-testid=snap-intersection]")
        driver.shot("05-measure-snap-preview.png")
        driver.click_at(154, 154)
        driver.click_at(446, 154)
        driver.wait_for("[data-testid=measure-text]")
        driver.shot("06-measure-length.png")
        driver.click("[data-testid=measure-card] button")  # save
        time.sleep(1)
        driver.js(
            "[...document.querySelectorAll('[data-testid=confirmed-list] li')]"
            ".find(li=>li.textContent.includes('Beams'))?.querySelector('.kind').click()"
        )  # select a clicked beam
        driver.click("[data-testid=attach]")
        time.sleep(1.2)
        driver.shot("07-measure-attached.png")

        # tables and takeoff
        driver.click("button[role=tab]:nth-of-type(2)")  # tables
        time.sleep(2)
        driver.js(
            "const a=document.querySelector('aside.right');"
            "const t=[...a.querySelectorAll('h4')].find(h=>h.textContent.includes('This page'));"
            "a.scrollTop=t?t.offsetTop-60:a.scrollHeight;"
        )
        time.sleep(0.5)
        driver.shot("08-tables-length-total-w.png")
        driver.click("button[role=tab]:nth-of-type(6)")  # takeoff
        time.sleep(2)
        driver.js(
            "const a=document.querySelector('aside.right');"
            "const n=document.querySelector('[data-testid=count-mode-note]');"
            "a.scrollTop=n?n.offsetTop-120:a.scrollHeight;"
        )
        time.sleep(0.5)
        driver.shot("09-takeoff-confirmed-and-suggested.png")
        log = api("GET", f"/api/projects/{pid}/count-actions")
        (SHOTS / "action-log-summary.json").write_text(
            json.dumps(
                {
                    "actions": [a["action"] for a in log["actions"]],
                    "time_per_page": log["time_per_page"],
                },
                indent=1,
            )
        )
        print("actions logged:", len(log["actions"]), flush=True)
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
