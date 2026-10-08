"""Minimal Firefox Marionette client for UI checks (screenshots, clicks, script execution).

Dev tool only: it talks to a LOCAL headless Firefox started with --marionette. No network service
is used. Usage:
    with Browser() as b:
        b.go("http://127.0.0.1:5173/#p=...&s=14")
        b.wait_for("document.querySelector('canvas') !== null")
        b.screenshot("fixtures/private/shots/x.png")
"""

import base64
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time


class Browser:
    def __init__(self, width: int = 1700, height: int = 950, port: int = 2828):
        self.port = port
        self.size = (width, height)
        self.proc: subprocess.Popen | None = None
        self.sock: socket.socket | None = None
        self.next_id = 1
        self.profile = tempfile.mkdtemp(prefix="ffprofile-", dir=os.path.expanduser("~"))  # snap Firefox cannot read /tmp

    def __enter__(self) -> "Browser":
        env = dict(os.environ, MOZ_HEADLESS="1")
        self.proc = subprocess.Popen(
            ["firefox", "--headless", "--marionette", "--no-remote", "--profile", self.profile,
             f"--width={self.size[0]}", f"--height={self.size[1]}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        )  # fmt: skip
        for _ in range(80):
            try:
                self.sock = socket.create_connection(("127.0.0.1", self.port), timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise RuntimeError("Firefox marionette did not start")
        self._read()  # server hello
        self.command("WebDriver:NewSession", {"capabilities": {}})
        self.command("WebDriver:SetWindowRect", {"width": self.size[0], "height": self.size[1]})
        return self

    def __exit__(self, *exc) -> None:
        try:
            self.command("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
        if self.proc:
            self.proc.terminate()
        shutil.rmtree(self.profile, ignore_errors=True)

    # -- protocol ---------------------------------------------------------------------------------
    def _read(self) -> object:
        assert self.sock
        buf = b""
        while b":" not in buf:
            buf += self.sock.recv(1)
        length = int(buf.split(b":")[0])
        data = b""
        while len(data) < length:
            data += self.sock.recv(length - len(data))
        return json.loads(data)

    def command(self, name: str, params: dict | None = None) -> dict:
        assert self.sock
        msg = json.dumps([0, self.next_id, name, params or {}]).encode()
        self.sock.sendall(str(len(msg)).encode() + b":" + msg)
        self.next_id += 1
        while True:
            reply = self._read()
            if isinstance(reply, list) and reply[1] == self.next_id - 1:
                if reply[2]:
                    raise RuntimeError(f"{name}: {reply[2].get('message', reply[2])}")
                return reply[3] or {}

    # -- helpers ----------------------------------------------------------------------------------
    def go(self, url: str) -> None:
        self.command("WebDriver:Navigate", {"url": url})

    def js(self, script: str, args: list | None = None) -> object:
        r = self.command("WebDriver:ExecuteScript", {"script": script, "args": args or []})
        return r.get("value")

    def wait_for(self, expr: str, timeout: float = 60.0) -> None:
        end = time.time() + timeout
        while time.time() < end:
            if self.js(f"return Boolean({expr});"):
                return
            time.sleep(0.4)
        raise TimeoutError(f"condition not met: {expr}")

    def screenshot(self, path: str, full: bool = False) -> None:
        r = self.command("WebDriver:TakeScreenshot", {"full": full, "hash": False})
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(r["value"]))


def _pointer(actions: list[dict]) -> dict:
    return {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": actions}]}


def _move(x: float, y: float, duration: int = 0) -> dict:
    return {"type": "pointerMove", "duration": duration, "x": int(x), "y": int(y), "origin": "viewport"}


def _key(keys: list[dict]) -> dict:
    return {"actions": [{"type": "key", "id": "kbd", "actions": keys}]}


def click(self: Browser, x: float, y: float) -> None:
    self.command(
        "WebDriver:PerformActions",
        _pointer([_move(x, y), {"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0}]),
    )


def drag(self: Browser, x0: float, y0: float, x1: float, y1: float) -> None:
    self.command(
        "WebDriver:PerformActions",
        _pointer([
            _move(x0, y0), {"type": "pointerDown", "button": 0},
            _move((x0 + x1) / 2, (y0 + y1) / 2, 50), _move(x1, y1, 50), {"type": "pointerUp", "button": 0},
        ]),
    )  # fmt: skip


def press(self: Browser, text: str) -> None:
    """Type characters (each as key down + up) into the focused element."""
    keys = []
    for ch in text:
        keys += [{"type": "keyDown", "value": ch}, {"type": "keyUp", "value": ch}]
    self.command("WebDriver:PerformActions", _key(keys))


def center_of(self: Browser, selector: str) -> tuple[float, float]:
    r = self.js(
        "const r = document.querySelector(arguments[0]).getBoundingClientRect();"
        "return [r.left + r.width / 2, r.top + r.height / 2];",
        [selector],
    )
    return r[0], r[1]  # type: ignore[index]


Browser.click = click  # type: ignore[attr-defined]
Browser.drag = drag  # type: ignore[attr-defined]
Browser.press = press  # type: ignore[attr-defined]
Browser.center_of = center_of  # type: ignore[attr-defined]
