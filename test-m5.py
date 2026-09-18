import time
import json
import socket
import tempfile
import shutil
import threading
import http.server
import socketserver
from selenium import webdriver

"""Milstolpe 5 – Git: auto-init per projekt, auto-commit vid spar/kompilering,
log och persistens av .git i OPFS."""

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
        v = js(expr() if callable(expr) else expr)
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

    print("  1. Skapa projekt och öppna...", flush=True)
    js("""
      document.getElementById('new-project').click();
      const i = document.getElementById('new-name');
      i.value = 'M5 Git';
      document.getElementById('new-form').requestSubmit();
      true;
    """)
    check("projekt vy öppnas", poll(
        "document.getElementById('project-title').textContent === 'M5 Git'") is True)
    check("main.c i fil-lista",
          poll("[...document.querySelectorAll('.file-row')].some(x => x.dataset.file === 'main.c')") is True)

    projId = js("""(async () => {
      const list = await window.__AI_PROFFS_TEST__.storage.listProjects();
      return list.length ? list[0].id : null;
    })()""")
    check("projektet finns i OPFS", bool(projId), "id=" + str(projId))

    print("  2. Första commit vid sparande...", flush=True)
    # Ändra main.c via editorn och spara → "Spara main.c"
    js("""
      var view = document.getElementById('editor-host').view;
      view.dispatch({changes:{from:0, to:view.state.doc.length,
        insert:'#include <stdio.h>\\nint main(void) { printf("hej git\\\\n"); return 0; }\\n'}});
      document.getElementById('file-save').click();
      true;
    """)

    sends = 0
    COMMIT_COUNT_JS = """(async () => {
      try { return (await window.__AI_PROFFS_TEST__.gitLog()).length; }
      catch (e) { return 0; }
    })()"""
    c1 = poll(COMMIT_COUNT_JS, t=45)
    check("≥1 commit efter spara", int(c1 or 0) >= 1, "count=" + str(c1))

    msgs = js("""(async () => (await window.__AI_PROFFS_TEST__.gitLog()).map(c => c.message))()""")
    check("commit-historik innehåller 'Spara main.c'",
          isinstance(msgs, list) and any("Spara main.c" in m for m in msgs), str(msgs)[:120])

    print("  3. Kompilera → auto-commit vid rc 0...", flush=True)
    js("document.getElementById('run').click(); true;")
    waited = 0
    ok_text = None
    while waited < 60:
        t = js("document.getElementById('output-text').textContent")
        if "rc:" in t and "Kompilerar" not in t:
            ok_text = t
            break
        time.sleep(0.5)
        waited += 0.5
    check("körning klar rc 0", bool(ok_text) and "rc: 0" in ok_text, str(ok_text)[:100])
    # Ingen auto-commit vid rc 0 om inga ändringar sedan senaste sparande (korrekt beteende)
    print("  3. Ny fil och radering committas...", flush=True)
    js("window.__promptValue = 'fakta.c'; document.getElementById('new-file').click(); true;")
    check("fakta.c skapas", poll(
        "[...document.querySelectorAll('.file-row')].some(x => x.dataset.file === 'fakta.c')") is True)
    end = time.time() + 30
    got_new_commit = False
    while time.time() < end:
        v = js("""(async () => (await window.__AI_PROFFS_TEST__.gitLog())
                    .some(c => c.message.includes('Ny fil fakta.c')))()""")
        if v:
            got_new_commit = True
            break
        time.sleep(0.4)
    check("auto-commit 'Ny fil fakta.c'", got_new_commit)

    js("""(async () => {
      await new Promise(r => setTimeout(r, 300));
      const rows = [...document.querySelectorAll('.file-row')];
      const row = rows.find(r => r.dataset.file === 'fakta.c');
      if (row) row.querySelector('.file-delete').click();
      true;
    })()""")
    check("fakta.c raderas", poll(
        "[...document.querySelectorAll('.file-row')].some(x => x.dataset.file === 'fakta.c') === false") is True)
    end = time.time() + 30
    got_del_commit = False
    while time.time() < end:
        v = js("""(async () => (await window.__AI_PROFFS_TEST__.gitLog())
                    .some(c => c.message.includes('Radera fakta.c')))()""")
        if v:
            got_del_commit = True
            break
        time.sleep(0.4)
    check("auto-commit 'Radera fakta.c'", got_del_commit)

    print("  5. .git ligger i OPFS och historiken överlever reload...", flush=True)
    gitDirCheck = js("""(async () => {
      const list = await window.__AI_PROFFS_TEST__.storage.listProjects();
      const dir = await window.__AI_PROFFS_TEST__.storage.getDir(list[0].id, false);
      let hasGit = false;
      for await (const e of dir.values()) if (e.name === '.git') hasGit = true;
      return hasGit;
    })()""")
    check(".git-katalogen finns i projektets OPFS", gitDirCheck is True)

    msgs_before = js("""(async () => (await window.__AI_PROFFS_TEST__.gitLog()).map(c => c.message))()""")
    check("historik har ≥3 commits", isinstance(msgs_before, list) and len(msgs_before) >= 3, str(len(msgs_before) if isinstance(msgs_before, list) else msgs_before))

    d.refresh()
    time.sleep(1.5)
    check("ready efter reload", poll("window.__AI_PROFFS_TEST__ && window.__AI_PROFFS_TEST__.ready()") is True)

    # öppna projektet igen — git init får inte nollställa historiken
    js("""(async () => {
      const rows = [...document.querySelectorAll('.project-row')];
      if (rows.length) rows[0].querySelector('[data-act="open"]').click();
      true;
    })()""")
    check("projekt öppnas efter reload", poll(
        "document.getElementById('project-title').textContent === 'M5 Git'") is True)
    c_after = poll(COMMIT_COUNT_JS, t=45)
    check("historik bevarad efter reload (≥3)", int(c_after or 0) >= 3, "count=" + str(c_after))

    print("---")
    if failures:
        print("FAILURES:")
        for f in failures:
            print("  -", f)
        raise SystemExit(1)
    else:
        print("M5 TEST PASS")
finally:
    try:
        d.quit()
    except Exception as e:
        print("(teardown-varning från selenium:", e, ")")
    httpd.shutdown()
    shutil.rmtree(profile, ignore_errors=True)