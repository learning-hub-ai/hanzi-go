#!/usr/bin/env python3
"""
Run test.html in headless Chrome and report pass/fail on stdout.

--dump-dom does not work for this page: the hidden iframe plus the service
worker keep the page from ever reaching a quiescent state, so Chrome never
prints. This drives Chrome over the DevTools Protocol instead, clicks the
run button via ?autorun=1, and polls for the #ciSummary marker.

Usage:
    python3 scripts/run_tests_headless.py [--port 8099] [--timeout 120]

Exit code 0 if all tests passed, 1 otherwise.
Requires: websocket-client (pip install websocket-client)
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

try:
    import websocket  # type: ignore
except ImportError:
    sys.exit("websocket-client not installed: pip install websocket-client")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _find_chrome():
    for name in ("google-chrome", "chromium", "chromium-browser", "google-chrome-stable"):
        path = shutil.which(name)
        if path:
            return path
    sys.exit("No Chrome/Chromium found on PATH")


def _cdp_send(ws, msg_id, method, params=None, timeout=20):
    """Send a CDP command and return its reply.

    Events arrive interleaved with command replies on the same socket, so this
    reads until it sees the matching id and discards anything else. A deadline
    keeps a missing reply from hanging the run forever.
    """
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            msg = json.loads(ws.recv())
        except Exception:
            break
        if msg.get("id") == msg_id:
            return msg
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0, help="http server port (0 = pick free)")
    ap.add_argument("--timeout", type=int, default=120, help="seconds to wait for tests")
    args = ap.parse_args()

    http_port = args.port or _free_port()
    cdp_port = _free_port()
    chrome = _find_chrome()
    profile = tempfile.mkdtemp(prefix="hanzigo-test-")

    httpd = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(http_port)],
        cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    browser = None
    try:
        # Wait for the static server to accept connections
        for _ in range(40):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{http_port}/test.html", timeout=1)
                break
            except Exception:
                time.sleep(0.25)
        else:
            sys.exit("http.server did not come up")

        url = f"http://127.0.0.1:{http_port}/test.html?autorun=1"
        browser = subprocess.Popen(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             f"--remote-debugging-port={cdp_port}", f"--user-data-dir={profile}",
             # Chrome >=111 rejects CDP websockets whose Origin it does not know
             "--remote-allow-origins=*",
             "--no-first-run", "--disable-extensions", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

        # Find the page target. Chrome is started on about:blank and navigated
        # over CDP: passing the URL on the command line left the tab blank in
        # headless=new, with the target still reporting the intended URL.
        ws_url = None
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json/list", timeout=1) as r:
                    for t in json.load(r):
                        if t.get("type") == "page":
                            ws_url = t["webSocketDebuggerUrl"]
                            break
                if ws_url:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not ws_url:
            sys.exit("Could not attach to a page target over CDP")

        ws = websocket.create_connection(ws_url, timeout=args.timeout + 10)
        msg_id = 0

        msg_id += 1
        _cdp_send(ws, msg_id, "Page.navigate", {"url": url})

        # Wait for the document to actually be the test page
        for _ in range(60):
            msg_id += 1
            resp = _cdp_send(ws, msg_id, "Runtime.evaluate", {
                "expression": "location.href + '|' + (document.getElementById('runBtn') ? 'ready' : 'no')",
                "returnByValue": True,
            })
            val = (resp.get("result", {}).get("result", {}) or {}).get("value") or ""
            if "test.html" in val and val.endswith("ready"):
                break
            time.sleep(0.5)
        else:
            sys.exit("Test page did not load")

        deadline = time.time() + args.timeout
        summary = None

        while time.time() < deadline:
            msg_id += 1
            resp = _cdp_send(ws, msg_id, "Runtime.evaluate", {
                "expression": "(document.getElementById('ciSummary')||{}).innerText||''",
                "returnByValue": True,
            })
            text = (resp.get("result", {}).get("result", {}) or {}).get("value") or ""
            m = re.search(r"passed=(\d+) failed=(\d+) total=(\d+)", text)
            if m:
                summary = tuple(int(x) for x in m.groups())
                break
            time.sleep(1)

        if not summary:
            sys.exit(f"Tests did not finish within {args.timeout}s")

        passed, failed, total = summary

        # Pull the failing test names so the output is actionable
        if failed:
            msg_id += 1
            resp = _cdp_send(ws, msg_id, "Runtime.evaluate", {
                "expression": (
                    "Array.from(document.querySelectorAll('.test-fail,.fail'))"
                    ".map(e=>e.innerText.trim()).join('\\n')"
                ),
                "returnByValue": True,
            })
            detail = (resp.get("result", {}).get("result", {}) or {}).get("value") or ""
            if detail.strip():
                print("Failing tests:")
                for line in detail.splitlines():
                    print(f"  {line}")
                print()

        status = "PASS" if failed == 0 else "FAIL"
        print(f"{status}: {passed} passed, {failed} failed, {total} total")
        ws.close()
        return 0 if failed == 0 else 1

    finally:
        for proc in (browser, httpd):
            if proc:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
