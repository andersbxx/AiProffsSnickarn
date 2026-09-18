(function () {
  "use strict";

  const INDEX_FILE = "index.json";
  const IGNORE = new Set([INDEX_FILE]);
  let rootHandle = null;

  async function openRoot() {
    if (!rootHandle)
      rootHandle = await navigator.storage.getDirectory();
    return rootHandle;
  }

  async function readJSON(fileHandle) {
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  }

  async function writeJSON(fileHandle, value) {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(value));
    await writable.close();
  }

  async function writeText(fileHandle, text) {
    const writable = await fileHandle.createWritable();
    await writable.write(String(text));
    await writable.close();
  }

  async function getIndexFile() {
    const root = await openRoot();
    return root.getFileHandle(INDEX_FILE, { create: true });
  }

  async function loadIndex() {
    const fh = await getIndexFile();
    let index;
    try {
      index = await readJSON(fh);
    } catch (err) {
      index = { v: 1, projects: [] };
    }
    if (!index || !Array.isArray(index.projects))
      index = { v: 1, projects: [] };
    return index;
  }

  async function saveIndex(index) {
    const fh = await getIndexFile();
    await writeJSON(fh, index);
  }

  async function sortProjects(index) {
    index.projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function touchProject(index, id) {
    const p = index.projects.find(p => p.id === id);
    if (p)
      p.updatedAt = Date.now();
  }

  async function projectDir(id, create) {
    const root = await openRoot();
    return root.getDirectoryHandle("projects", { create })
      .then(d => d.getDirectoryHandle(id, { create }));
  }

  // Publikt: används av git-adaptern (js/gitfs.js) som rot för repo per projekt.
  function getDir(id, create) {
    return projectDir(id, create);
  }

  async function listProjects() {
    const index = await loadIndex();
    const withStats = await Promise.all(index.projects.map(async p => {
      let fileCount = 0;
      try {
        const dir = await projectDir(p.id, false);
        for await (const entry of dir.values()) {
          if (entry.kind === "file")
            fileCount += 1;
        }
      } catch (err) {
        fileCount = 0;
      }
      return { ...p, fileCount };
    }));
    withStats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return withStats;
  }

  const STARTER_MAIN_C = [
    "#include <stdio.h>",
    "",
    "static int fib(int n)",
    "{",
    "    if (n <= 1)",
    "        return n;",
    "    return fib(n - 1) + fib(n - 2);",
    "}",
    "",
    "int main(void)",
    "{",
    "    for (int i = 0; i <= 10; i++)",
    "        printf(\"fib(%d)=%d\\n\", i, fib(i));",
    "    return 0;",
    "}",
    ""
  ].join("\n");

  async function createProject(name) {
    const cleanName = String(name || "").trim();
    if (!cleanName)
      throw new Error("tomt projektnamn");
    const id = crypto.randomUUID();
    const index = await loadIndex();
    const now = Date.now();
    index.projects.push({ id, name: cleanName, createdAt: now, updatedAt: now });
    await sortProjects(index);
    await saveIndex(index);
    const dir = await projectDir(id, true);
    const fh = await dir.getFileHandle("main.c", { create: true });
    await writeText(fh, STARTER_MAIN_C);
    return id;
  }

  async function renameProject(id, name) {
    const cleanName = String(name || "").trim();
    if (!cleanName)
      throw new Error("tomt projektnamn");
    const index = await loadIndex();
    const p = index.projects.find(p => p.id === id);
    if (!p)
      throw new Error("projektet finns inte");
    p.name = cleanName;
    await touchProject(index, id);
    await saveIndex(index);
    return p;
  }

  async function deleteProject(id) {
    const index = await loadIndex();
    index.projects = index.projects.filter(p => p.id !== id);
    await saveIndex(index);
    try {
      const root = await openRoot();
      const projectsDir = await root.getDirectoryHandle("projects");
      await projectsDir.removeEntry(id, { recursive: true });
    } catch (err) {
      // katalog kanske redan saknas; index är uppdaterat ändå
    }
  }

  async function listFiles(id) {
    const dir = await projectDir(id, false);
    const files = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "file")
        files.push(entry.name);
    }
    return files.sort((a, b) => a.localeCompare(b));
  }

  async function readFile(id, path) {
    const dir = await projectDir(id, false);
    const fh = await dir.getFileHandle(path);
    const file = await fh.getFile();
    return await file.text();
  }

  async function saveFile(id, path, content) {
    const dir = await projectDir(id, true);
    const fh = await dir.getFileHandle(path, { create: true });
    const writable = await fh.createWritable();
    await writable.write(String(content));
    await writable.close();
    const index = await loadIndex();
    await touchProject(index, id);
    await saveIndex(index);
  }

  async function deleteFile(id, path) {
    const dir = await projectDir(id, false);
    await dir.removeEntry(path);
    const index = await loadIndex();
    await touchProject(index, id);
    await saveIndex(index);
  }

  const api = {
    listProjects,
    createProject,
    renameProject,
    deleteProject,
    getDir,
    listFiles,
    readFile,
    saveFile,
    deleteFile
  };

  if (typeof module === "object" && module.exports)
    module.exports = api;
  else
    globalThis.AiProffsStorage = api;
})();