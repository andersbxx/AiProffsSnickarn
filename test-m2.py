import time
import json
import socket
import tempfile
import shutil
import threading
import http.server
import socketserver
from selenium import webdriver

ROOT = "/home/anders/AiProffsSnickarn"


class ReuseServer(socketserver.TCPServer):
    allow_reuse_address = True


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass


PORT = free_port()
httpd = ReuseServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

profile = tempfile.mkdtemp(prefix="aiproffs-profile-")

opts = webdriver.ChromeOptions()
opts.add_argument("--headless")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--user-data-dir=%s" % profile)
d = webdriver.Chrome(options=opts)
cdp = d.execute_cdp_cmd

failures = []


def js(expr):
    r = cdp("Runtime.evaluate", {
        "expression": expr,
        "returnByValue": True,
        "awaitPromise": True,
    })
    if "exceptionDetails" in r and r["exceptionDetails"]:
        failures.append(r["exceptionDetails"].get("text")
                        + ": " + str(r["exceptionDetails"].get("exception", {}).get("description")))
        return None
    return r.get("result", {}).get("value")


def poll(expr, t=45):
    end = time.time() + t
    while time.time() < end:
        v = js(expr)
        if v:
            return v
        time.sleep(0.4)
    return None


def check(label, cond, extra=""):
    if not cond:
        failures.append("%s %s" % (label, extra))
        print("  FAIL", label, extra)
    else:
        print("  ok  ", label)


try:
    d.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
      window.confirm = () => true;
      window.__promptValue = null;
      window.prompt = (msg, val) => window.__promptValue !== null ? window.__promptValue : val;
      window.__errs = [];
      window.addEventListener('error', e => window.__errs.push(e.message));
    """})

    base = "http://127.0.0.1:%d" % PORT
    d.get(base + "/index.html")

    check("ready efter boot", poll("window.__AI_PROFFS_TEST__ && window.__AI_PROFFS_TEST__.ready()") is True)

    check("tom lista initialt",
          poll("document.querySelectorAll('.project-row').length === 0")
          and js("!document.getElementById('project-list-empty').classList.contains('hidden')"))

    js("""
      document.getElementById('new-project').click();
      const i = document.getElementById('new-name');
      i.value = 'TestProjekt';
      document.getElementById('new-form').requestSubmit();
      true;
    """)

    check("projekt vy öppnas", poll(
        "document.getElementById('project-title').textContent === 'TestProjekt'") is True)

    check("main.c i fil-lista",
          poll("[...document.querySelectorAll('.file-row')].some(x => x.dataset.file === 'main.c')") is True)

    projId = js("""(async () => {
      const list = await window.__AI_PROFFS_TEST__.storage.listProjects();
      return list.length ? list[0].id : null;
    })()""")

    check("projektet finns i OPFS", bool(projId), "id=" + str(projId))

    mainContent = js("""(async () => {
      const list = await window.__AI_PROFFS_TEST__.storage.listProjects();
      if (!list.length) return '__none__';
      return await window.__AI_PROFFS_TEST__.storage.readFile(list[0].id, 'main.c');
    })()""")
    check("main.c innehåller fib", "fib" in (mainContent or ""), str(mainContent)[:60])

    # tillbaka till listan och byt namn
    js("document.getElementById('back-to-list').click(); true;")
    check("tillbaka till lista", poll(
        "document.getElementById('projects-view').classList.contains('hidden') === false") is True)
    js("window.__promptValue = 'DöptOm'; true;")
    js("""(async () => {
      await new Promise(r => setTimeout(r, 200));
      const row = document.querySelector('.project-row');
      if (row) row.querySelector('[data-act="rename"]').click();
      true;
    })()""")
    check("byte av namn visas", poll(
        "[...document.querySelectorAll('.project-name')].some(e => e.textContent === 'DöptOm')") is True)

    # andra projekt för persistens-test
    js("""
      document.getElementById('new-project').click();
      var newName2 = document.getElementById('new-name');
      newName2.value = 'Andra';
      document.getElementById('new-form').requestSubmit();
      true;
    """)
    check("andra projektet öppnas", poll(
        "document.getElementById('project-title').textContent === 'Andra'") is True)
    js("document.getElementById('back-to-list').click(); true;")
    check("två projekt i listan", poll(
        "document.querySelectorAll('.project-name').length === 2") is True)

    # sv-sw check
    check("SW registrerad", poll("""(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && reg.active);
    })()""") is True)
    check("SW-cache aiproffs-v1 existerar", poll("""(async () => {
      const keys = await caches.keys();
      return keys.includes('aiproffs-v1');
    })()""") is True)

    # reload — persistens
    d.refresh()
    time.sleep(1.5)
    check("ready efter reload", poll("window.__AI_PROFFS_TEST__ && window.__AI_PROFFS_TEST__.ready()") is True)
    names = js("[...document.querySelectorAll('.project-name')].map(e => e.textContent)")
    check("två projekt kvar efter reload", names == ["Andra", "DöptOm"], str(names))

    # radera 'DöptOm'
    js("""(async () => {
      await new Promise(r => setTimeout(r, 300));
      const rows = [...document.querySelectorAll('.project-row')];
      const row = rows.find(r => r.querySelector('.project-name').textContent === 'DöptOm');
      if (row) row.querySelector('[data-act="delete"]').click();
      true;
    })()""")
    check("raderat projekt försvinner", poll(
        "[...document.querySelectorAll('.project-name')].length === 1") is True)

    st = js("[...document.querySelectorAll('.project-name')].map(e => e.textContent)")
    check("endast 'Andra' kvar", st == ["Andra"], str(st))

    print("---")
    if failures:
        print("FAILURES:")
        for f in failures:
            print("  -", f)
        raise SystemExit(1)
    else:
        print("M2 TEST PASS")
finally:
    try:
        d.quit()
    except Exception as e:
        print("(teardown-varning från selenium:", e, ")")
    httpd.shutdown()
    shutil.rmtree(profile, ignore_errors=True)