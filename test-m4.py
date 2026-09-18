#!/usr/bin/env python3
"""Milstolpe 4 – Kör-panel (kompilera + köra, visa stdout/stderr/rc)."""

import http.server, os, random, socketserver, threading, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

PORT = random.randint(9200, 9999)
BASE = Path("/home/anders/AiProffsSnickarn")
TMP = Path("/tmp/aiproffs-m4")
PROFILE = str(TMP / "profile")
TMP.mkdir(parents=True, exist_ok=True)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(BASE), **kw)
    def log_message(self, *_):
        pass

srv = socketserver.TCPServer(("", PORT), Handler)
srv.timeout = 0.5
threading.Thread(target=lambda: srv.serve_forever(), daemon=True).start()
print(f"  server på port {PORT}", flush=True)

chrome_opts = Options()
chrome_opts.binary_location = "/usr/bin/chromium"
chrome_opts.add_argument("--headless=new")
chrome_opts.add_argument("--no-sandbox")
chrome_opts.add_argument("--disable-gpu")
chrome_opts.add_argument(f"--user-data-dir={PROFILE}")
chrome_opts.add_argument("--disable-dev-shm-usage")
drv = webdriver.Chrome(options=chrome_opts)
drv.set_page_load_timeout(60)

def js(code):
    return drv.execute_script(code)

def jsr(code):
    return drv.execute_script(f"return ({code})")

try:
    print("  1. Boot...", flush=True)
    drv.get(f"http://localhost:{PORT}/index.html")
    time.sleep(1.5)
    assert jsr("__AI_PROFFS_TEST__.ready()"), "Inte redo"
    print("    [OK] redo", flush=True)

    print("  2. Skapa projekt...", flush=True)
    js("window.confirm = () => true")
    js("document.getElementById('new-project').click()")
    time.sleep(0.2)
    inp = drv.find_element(By.ID, "new-name")
    inp.send_keys("M4 Test")
    inp.submit()
    drv.execute_async_script("""
      var cb = arguments[arguments.length - 1];
      (function wait() {
        if (!document.getElementById('project-view').classList.contains('hidden'))
          return cb();
        setTimeout(wait, 200);
      })();
    """)
    time.sleep(0.5)
    title = drv.find_element(By.ID, "project-title").text
    assert title == "M4 Test", f"Titel: {title}"
    print("    [OK] projekt skapat", flush=True)

    print("  3. Sätt in C-kod som skriver till stdout...", flush=True)
    js("""
      var view = document.getElementById('editor-host').view;
      view.dispatch({changes:{from:0, to:view.state.doc.length,
        insert:'#include <stdio.h>\\nint main(void) { printf("hej m4\\\\n"); return 0; }\\n'}});
    """)
    print("    [OK] kod insatt", flush=True)

    print("  4. Kör...", flush=True)
    js("__AI_PROFFS_TEST__.runCurrent()")
    # vänta på rc-radan (tcc.wasm laddas första gången — kan ta en stund)
    waited = 0
    ok_text = None
    while waited < 60:
        t = jsr("document.getElementById('output-text').textContent")
        if "rc:" in t and "Kompilerar" not in t:
            ok_text = t
            break
        time.sleep(0.5)
        waited += 0.5
    assert ok_text, "Ingen körad resultat inom 60 s"
    print("    [OK] körning klar", flush=True)
    print("    ---"); print(ok_text); print("    ---", flush=True)
    assert "hej m4" in ok_text, f"Saknar stdout: {ok_text}"
    assert "rc: 0" in ok_text, f"rc förväntades 0: {ok_text}"

    print("  5. Kompilatorfel visas...", flush=True)
    js("""
      var view = document.getElementById('editor-host').view;
      view.dispatch({changes:{from:0, to:view.state.doc.length,
        insert:'int main(void) { oops syntax error ; }\\n'}});
    """)
    time.sleep(0.5)  # allow editor to process change
    prev_t = jsr("document.getElementById('output-text').textContent")
    js("__AI_PROFFS_TEST__.runCurrent()")
    waited = 0
    err_text = None
    while waited < 60:
        t = jsr("document.getElementById('output-text').textContent")
        if t != prev_t and "rc:" in t:
            err_text = t
            break
        time.sleep(0.5)
        waited += 0.5
    assert err_text, "Inget felresultat"
    print("    [OK] felväg klar:", flush=True)
    print("    ---"); print(err_text[:400]); print("    ---", flush=True)
    assert "rc: 0" not in err_text, "Borde inte vara rc 0 vid fel"

    print("  6. Körknapp är inte blockerad...", flush=True)
    waited = 0
    while waited < 30:
        if jsr("document.getElementById('run').disabled") == False:
            break
        time.sleep(0.2)
        waited += 0.2
    assert jsr("document.getElementById('run').disabled") == False, "Körknapp fortfarande inaktiverad"
    print("    [OK]", flush=True)

    print("M4 TEST PASS", flush=True)
finally:
    drv.quit()
    srv.shutdown()