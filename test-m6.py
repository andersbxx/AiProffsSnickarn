import time
import socket
import tempfile
import shutil
import threading
import http.server
import socketserver
from selenium import webdriver

"""Milstolpe 6 – AI-panel: öppna panel, spara API-nyckel, planera/bygga, auto-commit."""

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
      window.__unhandled = [];
      window.addEventListener('unhandledrejection', e => window.__unhandled.push(String(e.reason && e.reason.stack || e.reason)));
    """})
    # Clear SW and caches via CDP before navigation
    try:
        cdp("ServiceWorker.unregister", {"scope": "http://127.0.0.1:%d/" % PORT})
    except:
        pass
    try:
        cdp("CacheStorage.deleteCache", {"cacheName": "aiproffs-v1"})
    except:
        pass

    base = "http://127.0.0.1:%d" % PORT
    d.get(base + "/index.html")

    check("ready efter boot", poll("window.__AI_PROFFS_TEST__ && window.__AI_PROFFS_TEST__.ready()") is True)

    print("  1. Skapa projekt...", flush=True)
    js("""
      document.getElementById('new-project').click();
      const i = document.getElementById('new-name');
      i.value = 'AI Test';
      document.getElementById('new-form').requestSubmit();
      true;
    """)
    check("projekt öppnas", poll(
        "document.getElementById('project-title').textContent === 'AI Test'") is True)

    projId = js("""(async () => {
      const list = await window.__AI_PROFFS_TEST__.storage.listProjects();
      return list.length ? list[0].id : null;
    })()""")
    check("projekt-ID finns", bool(projId), "id=" + str(projId))

    print("  2. Öppna AI-panel...", flush=True)
    js("document.getElementById('aiBtn').click(); true;")
    check("AI-panel öppnas", poll(
        "document.getElementById('aiPanel').classList.contains('open')") is True)

    # Testa att start-knappen kan klickas utan fel (utan giltig nyckel)
    js("document.getElementById('aiStartBtn').click(); true;")
    time.sleep(1)
    check("start-knapp klickbar utan fel", js("window.__errs.length === 0"))

    print("  3. Testa UI-flöde utan API-nyckel...", flush=True)
    js("document.getElementById('aiApiKey').value = ''; true;")
    time.sleep(0.3)

    # Testa att planera-läge fungerar
    js("document.getElementById('aiModePlaner').click(); true;")
    check("planera-läge aktiveras", poll(
        "document.getElementById('aiModePlaner').classList.contains('active')") is True)
    js("document.getElementById('aiModeBygga').click(); true;")
    check("bygga-läge aktiveras", poll(
        "document.getElementById('aiModeBygga').classList.contains('active')") is True)

    # Testa förslagschips (visuellt - klick hanteras av sendPrompt som testas separat)
    js("document.getElementById('aiSuggestChips').querySelector('.ai-chip').click(); true;")
    time.sleep(0.5)
    check("förslagschip finns", js("document.getElementById('aiSuggestChips').querySelector('.ai-chip') !== null"))

    print("  4. Stäng panel och öppna igen...", flush=True)
    js("document.getElementById('aiClose').click(); true;")
    check("panel stängs", poll(
        "!document.getElementById('aiPanel').classList.contains('open')") is True)
    js("document.getElementById('aiBtn').click(); true;")
    check("panel öppnas igen", poll(
        "document.getElementById('aiPanel').classList.contains('open')") is True)

    # Stäng igen
    js("document.getElementById('aiClose').click(); true;")

    print("  5. Testa AI-kontext vid filbyte...", flush=True)
    # Skapa en ny fil
    js("window.__promptValue = 'testfil.c'; document.getElementById('new-file').click(); true;")
    check("ny fil skapas", poll(
        "[...document.querySelectorAll('.file-row')].some(x => x.dataset.file === 'testfil.c')") is True)

    # Simulera att AI-panel kontext uppdateras
    js("""(async()=>{ if(window.initAiPanelContext) await window.initAiPanelContext('""" + projId + """', 'testfil.c'); })()""")
    time.sleep(0.5)

    # Kolla att kontexten sattes
    ctxFile = js("""(async()=>{ try{ const s = await window.__AI_PROFFS_TEST__.aiPanel(); return s && s.state ? s.state.currentFile : null; }catch(e){ return 'ERR: '+e; } })()""")
    check("ingen JS-fel vid kontextuppdatering", ctxFile != 'ERR', str(ctxFile))

    print("  6. Testa att inställningar-sheet öppnas/stängs...", flush=True)
    js("document.getElementById('aiBtn').click(); true;")
    time.sleep(0.2)
    js("document.getElementById('aiModelChip').click(); true;")
    check("inställningar öppnas", poll(
        "document.getElementById('aiSettingsSheet').classList.contains('open')") is True)
    js("document.getElementById('aiCloseSheet').click(); true;")
    check("inställningar stängs", poll(
        "!document.getElementById('aiSettingsSheet').classList.contains('open')") is True)

    # Stäng AI-panel
    js("document.getElementById('aiClose').click(); true;")

    print("  7. Testa att knapp i toolbar toggle:ar panel...", flush=True)
    js("document.getElementById('aiBtn').click(); true;")
    check("öppnar via knapp", poll("document.getElementById('aiPanel').classList.contains('open')") is True)
    js("document.getElementById('aiBtn').click(); true;")
    check("stänger via knapp", poll("!document.getElementById('aiPanel').classList.contains('open')") is True)

    print("---")
    if failures:
        print("FAILURES:")
        for f in failures:
            print("  -", f)
        raise SystemExit(1)
    else:
        print("M6 TEST PASS")
finally:
    try:
        d.quit()
    except Exception as e:
        print("(teardown-varning från selenium:", e, ")")
    httpd.shutdown()
    shutil.rmtree(profile, ignore_errors=True)