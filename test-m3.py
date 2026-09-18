#!/usr/bin/env python3
"""Milstolpe 3 – CodeMirror + filtree."""

import http.server, json, os, random, socketserver, sys, threading, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

PORT = random.randint(9200, 9999)
BASE = Path("/home/anders/AiProffsSnickarn")
TMP = Path("/tmp/aiproffs-m3")
PROFILE = str(TMP / "profile")
LOG = TMP / "chrome.log"
LOG.parent.mkdir(parents=True, exist_ok=True)

# --- HTTP-server -----------------------------------------------------------

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(BASE), **kw)
    def log_message(self, *_):
        pass

srv = socketserver.TCPServer(("", PORT), Handler)
srv.timeout = 0.5
t = threading.Thread(target=lambda: srv.serve_forever(), daemon=True)
t.start()
print(f"  server på port {PORT}", flush=True)

# --- Chrome + Selenium -----------------------------------------------------

chrome_opts = Options()
chrome_opts.binary_location = "/usr/bin/chromium"
chrome_opts.add_argument("--headless=new")
chrome_opts.add_argument("--no-sandbox")
chrome_opts.add_argument("--disable-gpu")
chrome_opts.add_argument(f"--user-data-dir={PROFILE}")
chrome_opts.add_argument("--window-size=1280,720")
chrome_opts.add_experimental_option("prefs", {
    "download.default_directory": str(TMP),
    "profile.default_content_setting_values.popups": 1
})
drv = webdriver.Chrome(options=chrome_opts)
drv.set_page_load_timeout(30)

def js(code):
    return drv.execute_script(code)

def jsr(code):
    return drv.execute_script(f"return ({code})")

try:
    print("  1. Boot och ladda...", flush=True)
    drv.get(f"http://localhost:{PORT}/index.html")
    time.sleep(1.5)

    assert jsr("__AI_PROFFS_TEST__.ready()"), "Inte redo"

    drv.execute_async_script("""
      var cb = arguments[arguments.length - 1];
      (function wait() {
        if (globalThis.AiProffsEditor) return cb();
        setTimeout(wait, 100);
      })();
    """)
    print("    [OK] redo + editor modul laddad", flush=True)

    print("  2. Skapa projekt...", flush=True)
    projects_view = drv.find_element(By.ID, "projects-view")
    empty_el = drv.find_element(By.ID, "project-list-empty")
    assert not projects_view.is_displayed() or empty_el.is_displayed()

    js("window.confirm = () => true")
    js("document.getElementById('new-project').click()")
    time.sleep(0.2)
    inp = drv.find_element(By.ID, "new-name")
    inp.send_keys("M3 Test")
    inp.submit()

    drv.execute_async_script("""
      var cb = arguments[arguments.length - 1];
      (function wait() {
        if (!document.getElementById('project-view').classList.contains('hidden'))
          return cb();
        setTimeout(wait, 200);
      })();
    """)
    time.sleep(0.3)

    assert jsr("document.getElementById('project-view').classList.contains('hidden')") == False
    title = drv.find_element(By.ID, "project-title").text
    assert title == "M3 Test", f"Titel: {title}"
    print("    [OK] projekt skapat", flush=True)

    print("  3. CodeMirror visas med main.c...", flush=True)
    time.sleep(0.5)
    cm = drv.find_elements(By.CSS_SELECTOR, "#editor-host .cm-editor")
    assert len(cm) > 0, "CodeMirror-synlig"
    editor_content = jsr("document.querySelector('#editor-host .cm-content').textContent")
    assert "fib" in editor_content or "include" in editor_content, f"Inget main.c: {editor_content[:80]}"
    print("    [OK] editor med main.c", flush=True)

    print("  4. Välj filer i träd...", flush=True)
    file_rows = drv.find_elements(By.CSS_SELECTOR, ".file-row")
    assert len(file_rows) >= 1, f"Bara {len(file_rows)} filer"
    file_names = [r.find_element(By.CSS_SELECTOR, ".file-name").text for r in file_rows]
    assert "main.c" in file_names, f"main.c saknas: {file_names}"
    active = drv.find_elements(By.CSS_SELECTOR, ".file-row.active")
    assert len(active) == 1, f"{len(active)} aktiva"
    print(f"    [OK] filer: {file_names}", flush=True)

    print("  5. Editera + spara...", flush=True)
    jsr("document.querySelector('#editor-host .cm-content').click()")
    # ändra innehåll
    js("""
      var view = document.getElementById('editor-host').view;
      view.dispatch({changes:{from:0, to:view.state.doc.length, insert:'// test\\n#include <stdio.h>\\nint main(){printf(\"hej\\\\n\");}\\n'}});
    """)
    time.sleep(0.2)
    js("document.getElementById('file-save').click()")
    time.sleep(0.5)
    status = drv.find_element(By.ID, "status").text
    assert "Sparat" in status, f"Sparat-status saknas: {status}"
    print("    [OK] editerat + sparat", flush=True)

    print("  6. Persistens efter reload...", flush=True)
    drv.get(f"http://localhost:{PORT}/index.html")
    time.sleep(1.5)
    assert jsr("__AI_PROFFS_TEST__.ready()"), "Inte redo efter reload"
    drv.execute_async_script("""
      var cb = arguments[arguments.length - 1];
      (async function() {
        var list = await __AI_PROFFS_TEST__.storage.listProjects();
        await __AI_PROFFS_TEST__.openProject(list[0].id);
        cb();
      })();
    """)
    time.sleep(1)
    cm2 = drv.find_elements(By.CSS_SELECTOR, "#editor-host .cm-editor")
    assert len(cm2) > 0, "CodeMirror saknas efter reload"
    content2 = jsr("document.querySelector('#editor-host .cm-content').textContent")
    assert "hej" in content2, f"Innehåll ej sparat: {content2[:120]}"
    print("    [OK] innehåll sparat", flush=True)

    print("  7. Ny fil...", flush=True)
    js("__AI_PROFFS_TEST__.newFile()")
    time.sleep(0.3)
    # prompt i modal — godkänn
    inp2 = drv.switch_to.alert
    inp2.send_keys("math.c")
    inp2.accept()
    time.sleep(0.8)
    file_rows2 = drv.find_elements(By.CSS_SELECTOR, ".file-row")
    file_names2 = [r.find_element(By.CSS_SELECTOR, ".file-name").text for r in file_rows2]
    assert "math.c" in file_names2, f"math.c saknas: {file_names2}"
    print("    [OK] ny fil skapad", flush=True)

    print("  8. Växla fil...", flush=True)
    # klicka på main.c
    for r in file_rows2:
        if r.find_element(By.CSS_SELECTOR, ".file-name").text == "main.c":
            r.click()
            break
    time.sleep(0.8)
    content3 = jsr("document.querySelector('#editor-host .cm-content').textContent")
    assert "hej" in content3, f"main.c inte i focus: {content3[:80]}"
    active2 = drv.find_elements(By.CSS_SELECTOR, ".file-row.active")
    assert len(active2) == 1
    print("    [OK] filväxling", flush=True)

    print("  9. Radera fil...", flush=True)
    js("window.confirm = () => true")
    js("__AI_PROFFS_TEST__.deleteActiveFile('math.c')")
    time.sleep(0.5)
    file_rows3 = drv.find_elements(By.CSS_SELECTOR, ".file-row")
    file_names3 = [r.find_element(By.CSS_SELECTOR, ".file-name").text for r in file_rows3]
    assert "math.c" not in file_names3, f"math.c kvar: {file_names3}"
    print("    [OK] fil raderad", flush=True)

    print("M3 TEST PASS", flush=True)
finally:
    drv.quit()
    srv.shutdown()
