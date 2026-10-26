"""Fixtures for the EMT-25 browser tests.

Starts the real emrs_server binary on a free port with an in-memory SQLite
database, serving the web/ directory, then drives it with Playwright.

Environment:
  EMRS_SERVER_BIN  path to emrs_server (default: build/emrs_server)
  EMRS_BROWSER_EXE optional Chromium executable (skips Playwright's download)
"""
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def server_url():
    port = _free_port()
    env = dict(os.environ, EMRS_DB=":memory:", EMRS_PORT=str(port), EMRS_WEB_DIR=str(ROOT / "web"))

    server_bin = os.environ.get("EMRS_SERVER_BIN")
    if server_bin and Path(server_bin).exists():
        cmd = [str(server_bin)]
    else:
        node_server = ROOT / "backend" / "src" / "server.js"
        cmd = ["node", str(node_server)]

    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            urllib.request.urlopen(f"{url}/api/health", timeout=0.5)
            break
        except Exception:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("EMRS server did not become healthy")
    yield url
    proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        exe = os.environ.get("EMRS_BROWSER_EXE")
        b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        yield b
        b.close()


@pytest.fixture()
def page(browser, server_url):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    pg = ctx.new_page()
    pg.goto(server_url)
    yield pg
    ctx.close()


_counter = iter(range(1, 10_000))


@pytest.fixture()
def unique_email():
    return f"user{next(_counter)}{int(time.time() * 1000) % 100000}@example.com"
