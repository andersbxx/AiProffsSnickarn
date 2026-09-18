(function () {
  "use strict";

  const el = id => document.getElementById(id);
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = {
    ready: false,
    view: "list",       // "list" | "project"
    activeId: null,
    activeFile: null,
    dirty: false,
    running: false
  };

  let runBtn = null;

  function setStatus(text, isError) {
    const statusEl = el("status");
    statusEl.textContent = text;
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function setView(view) {
    state.view = view;
    el("projects-view").classList.toggle("hidden", view !== "list");
    el("project-view").classList.toggle("hidden", view !== "project");
    el("back-to-list").classList.toggle("hidden", view === "list");
  }

  async function refreshList() {
    const projects = await AiProffsStorage.listProjects();
    const listEl = el("project-list");
    const emptyEl = el("project-list-empty");
    listEl.innerHTML = "";
    emptyEl.classList.toggle("hidden", projects.length > 0);
    for (const p of projects) {
      const row = document.createElement("article");
      row.className = "project-row";
      row.dataset.id = p.id;
      row.innerHTML = [
        '<div class="project-main">',
        '  <div>',
        '    <h3 class="project-name"></h3>',
        '    <div class="project-meta"></div>',
        "  </div>",
        '  <div class="project-actions">',
        '    <button class="ghost" data-act="open">Öppna</button>',
        '    <button class="ghost" data-act="rename">Byt namn</button>',
        '    <button class="danger-ghost" data-act="delete">Radera</button>',
        "  </div>",
        "</div>"
      ].join("");
      row.querySelector(".project-name").textContent = p.name;
      const updated = new Date(p.updatedAt).toLocaleString("sv-SE");
      row.querySelector(".project-meta").textContent =
        `${p.fileCount} filer · uppdaterad ${updated}`;
      row.querySelector('[data-act="open"]')
        .addEventListener("click", () => openProject(p.id));
      row.querySelector('[data-act="rename"]')
        .addEventListener("click", async () => {
          const name = window.prompt("Nytt namn:", p.name);
          if (name && name.trim() && name.trim() !== p.name) {
            await AiProffsStorage.renameProject(p.id, name.trim());
            await refreshList();
          }
        });
      row.querySelector('[data-act="delete"]')
        .addEventListener("click", async () => {
          if (!window.confirm(`Radera projektet ”${p.name}”?`))
            return;
          await AiProffsStorage.deleteProject(p.id);
          await refreshList();
        });
      listEl.appendChild(row);
    }
  }

  async function openProject(id) {
    state.activeId = id;
    if (globalThis.AiProffsGit)
      AiProffsGit.ensure(id).catch(err => console.warn("Git-init misslyckades:", err));
    await renderProject();
    setView("project");
  }

  async function renderProject() {
    const id = state.activeId;
    const projects = await AiProffsStorage.listProjects();
    const project = projects.find(p => p.id === id);
    if (!project)
      return backToList();
    el("project-title").textContent = project.name;
    await renderFileTree();
    if (!state.activeFile) {
      const files = await AiProffsStorage.listFiles(id);
      state.activeFile = files[0] || null;
    }
    if (state.activeFile)
      await openFile(state.activeFile);
  }

  async function renderFileTree() {
    const id = state.activeId;
    const files = await AiProffsStorage.listFiles(id);
    const fileList = el("file-list");
    fileList.innerHTML = "";
    for (const name of files) {
      const li = document.createElement("li");
      li.className = "file-row" + (name === state.activeFile ? " active" : "");
      li.dataset.file = name;
      li.innerHTML =
        '<span class="file-icon">C</span><span class="file-name"></span>' +
        '<button class="file-delete" type="button" title="Radera fil">×</button>';
      li.querySelector(".file-name").textContent = name;
      li.querySelector(".file-delete").addEventListener("click", e => {
        e.stopPropagation();
        deleteActiveFile(name);
      });
      li.addEventListener("click", () => openFile(name));
      fileList.appendChild(li);
    }
  }

  function currentView() {
    return el("editor-host").view || null;
  }

  async function gitCommit(message) {
    if (!globalThis.AiProffsGit || !state.activeId)
      return null;
    try {
      return await AiProffsGit.commitAll(state.activeId, message);
    } catch (err) {
      console.warn("Git-commit misslyckades:", err);
      return null;
    }
  }

  async function saveActive() {
    const id = state.activeId;
    const name = state.activeFile;
    const view = currentView();
    if (!id || !name || !view)
      return false;
    const content = AiProffsEditor.getContent(view);
    await AiProffsStorage.saveFile(id, name, content);
    state.dirty = false;
    setStatus("Sparat " + name);
    await AiProffsGit.commitAll(id, "Spara " + name, [name]);
    return true;
  }

  async function openFile(name) {
    const id = state.activeId;
    if (!id || (name === state.activeFile && currentView()))
      return;
    await saveActive();
    state.activeFile = name;
    let content = "";
    try {
      content = await AiProffsStorage.readFile(id, name);
    } catch (err) {
      content = "";
    }
    const view = AiProffsEditor.createEditor(el("editor-host"), {
      content,
      onSave: () => saveActive(),
      onRun: () => runCurrent(),
      onChange: () => {
        if (!state.dirty) {
          state.dirty = true;
          setStatus("…osparat");
        }
      }
    });
    AiProffsEditor.setContent(view, content);
    AiProffsEditor.setReadOnly(view, false);
    await renderFileTree();
    view.focus();
    if (window.initAiPanelContext)
      window.initAiPanelContext(id, name);
  }

  function sanitizeFilename(name) {
    name = String(name || "").trim();
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/.test(name) || !/\.(c|h)$/i.test(name))
      return null;
    return name;
  }

  async function newFile() {
    const id = state.activeId;
    if (!id)
      return;
    const name = sanitizeFilename(window.prompt("Filnamn (t.ex. fakta.c):", "ny.c"));
    if (!name) {
      setStatus("Ogiltigt filnamn — kräver ändelse .c eller .h", true);
      return;
    }
    if ((await AiProffsStorage.listFiles(id)).includes(name)) {
      setStatus("Filen finns redan: " + name, true);
      return;
    }
    await AiProffsStorage.saveFile(id, name, "");
    await renderFileTree();
    await openFile(name);
    await AiProffsGit.commitAll(state.activeId, "Ny fil " + name);
  }

  async function deleteActiveFile(name) {
    const id = state.activeId;
    if (!id || !window.confirm("Radera filen ”" + name + "”?"))
      return;
    await AiProffsStorage.deleteFile(id, name);
    await gitCommit("Radera " + name);
    if (state.activeFile === name) {
      state.activeFile = null;
      const files = await AiProffsStorage.listFiles(id);
      const view = currentView();
      if (files.length > 0) {
        state.activeFile = files[0];
        await openFile(state.activeFile);
      } else if (view) {
        AiProffsEditor.setContent(view, "");
        AiProffsEditor.setReadOnly(view, true);
        setStatus("Inga filer kvar");
      }
    }
    await renderFileTree();
  }

  function setOutput(text, isError) {
    const pane = el("output-text");
    pane.textContent = text || "";
    pane.classList.toggle("is-error", Boolean(isError));
    pane.scrollTop = pane.scrollHeight;
  }

  async function runCurrent() {
    const id = state.activeId;
    const name = state.activeFile;
    const view = currentView();
    if (!id || !name || !view || state.running)
      return;
    state.running = true;
    runBtn.disabled = true;
    try {
      await saveActive();
      const source = AiProffsEditor.getContent(view);
      setOutput("Kompilerar " + name + " (första gången laddas tcc.wasm…)");
      setStatus("Kompilerar…");
      const t0 = performance.now();
      const res = await AiProffsCompiler.compileAndRun(source, "");
      const ms = Math.round(performance.now() - t0);
      let text = "";
      if (res.diagnostics)
        text += "// " + name + " (kompilatorinfo)\n" + res.diagnostics + "\n\n";
      text += res.stdout;
      if (res.stderr)
        text += (res.stdout ? "\n" : "") + res.stderr;
      if (!res.stdout && !res.stderr)
        text += "(ingen utdata)";
      text += "\n\n// rc: " + res.rc + " · " + ms + " ms";
      setOutput(text, res.rc !== 0);
      setStatus(res.rc === 0 ? "Körning klar (rc 0)" : "Körning misslyckades (rc " + res.rc + ")", res.rc !== 0);
      if (res.rc === 0)
        await gitCommit("Lyckad körning av " + name);
    } catch (err) {
      console.error(err);
      setOutput("Fel vid kompilering/körning:\n" + String(err && err.message ? err.message : err), true);
      setStatus("Kunde inte köra", true);
    } finally {
      state.running = false;
      runBtn.disabled = false;
    }
  }

  async function backToList() {
    try {
      await saveActive();
    } catch (e) {
      console.warn("Kunde inte spara vid tillbakagående:", e);
    }
    state.activeId = null;
    state.activeFile = null;
    const host = el("editor-host");
    if (host.view) {
      host.view.destroy();
      host.view = null;
      host.innerHTML = "";
    }
    setView("list");
    await refreshList();
  }

  function setupNewProject() {
    const createBtn = el("new-project");
    const form = el("new-form");
    const input = el("new-name");
    createBtn.addEventListener("click", () => {
      form.classList.toggle("hidden");
      if (!form.classList.contains("hidden"))
        input.focus();
    });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name)
        return;
      input.value = "";
      form.classList.add("hidden");
      try {
        const id = await AiProffsStorage.createProject(name);
        setStatus("Skapade ”" + name + "”");
        await refreshList();
        await openProject(id);
      } catch (err) {
        setStatus("Kunde inte skapa: " + err.message, true);
      }
    });
  }

  async function init() {
    setupNewProject();
    runBtn = el("run");
    el("back-to-list").addEventListener("click", backToList);
    el("new-file").addEventListener("click", newFile);
    el("file-save").addEventListener("click", () => saveActive());
    runBtn.addEventListener("click", runCurrent);
    el("output-clear").addEventListener("click", () => setOutput(""));
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
      caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
      navigator.serviceWorker.register("./sw.js").catch(err => {
        console.warn("SW-registrering misslyckades", err);
      });
    }
    try {
      await refreshList();
      state.ready = true;
      setStatus("Redo");
    } catch (err) {
      setStatus("OPFS misslyckades: " + err.message, true);
    }
    if (window.initAiPanel) window.initAiPanel();
  }

  globalThis.__AI_PROFFS_TEST__ = {
    ready: () => state.ready,
    refreshList,
    openProject,
    backToList,
    getActiveFile: () => state.activeFile,
    saveActive,
    newFile,
    deleteActiveFile,
    openFile,
    runCurrent,
    gitCommit,
    gitLog: () => globalThis.AiProffsGit
      ? AiProffsGit.log(state.activeId, 20)
      : Promise.resolve([]),
    storage: AiProffsStorage,
    aiPanel: () => window.AiPanel || null,
    setAiContext: (projectId, fileName) => {
      if (window.initAiPanelContext) window.initAiPanelContext(projectId, fileName);
    }
  };

  init();
})();