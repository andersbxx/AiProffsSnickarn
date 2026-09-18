import time
import json
import http.server
import threading
import socketserver
import os
from selenium import webdriver

ROOT = "/home/anders/AiProffsSnickarn"
PORT = 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass


os.chdir(ROOT)
class ReuseServer(socketserver.TCPServer):
    allow_reuse_address = True


httpd = ReuseServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

opts = webdriver.ChromeOptions()
opts.add_argument("--headless")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--js-flags=--max-old-space-size=1024")
d = webdriver.Chrome(options=opts)
cdp = d.execute_cdp_cmd


def js(expr):
    r = cdp("Runtime.evaluate", {
        "expression": expr,
        "returnByValue": True,
        "awaitPromise": True,
    })
    return r.get("result", {}).get("value")


def poll(expr, t=60):
    end = time.time() + t
    while time.time() < end:
        v = js(expr)
        if v is not None:
            return v
        time.sleep(0.5)
    return None

try:
    d.get("http://127.0.0.1:%d/spike.html" % PORT)
    result = poll("window.__spike && window.__spike.phase")
    if not result:
        print("TIMEOUT: spike never reported")
        raise SystemExit(1)
    spike = js("window.__spike")
    print(json.dumps(spike, indent=2))
    if spike.get("ok") is True:
        print("SPIKE PASS")
    else:
        print("SPIKE FAIL")
        raise SystemExit(1)
finally:
    d.quit()
    httpd.shutdown()