(function () {
  "use strict";

  // isomorphic-git-fs-adapter över OPFS (enligt AGENTS.md ~80/100 rader).
  // Root = FileSystemDirectoryHandle (projektets katalog). Returnerar Promises.

  const FILE_MODE = 0o100644;
  const DIR_MODE = 0o040755;

  class Stats {
    constructor(type, size, mtimeMs, mode) {
      this.type = type;            // 'file' | 'dir'
      this.size = size;
      this.mode = mode;
      this.ino = 0;
      this.mtime = new Date(mtimeMs || 0);
      this.mtimeMs = mtimeMs || 0;
      this.ctime = new Date(mtimeMs || 0);
      this.ctimeMs = mtimeMs || 0;
      this.uid = 0;
      this.gid = 0;
      this.dev = 0;
    }
    isFile() { return this.type === "file"; }
    isDirectory() { return this.type === "dir"; }
    isBlockDevice() { return false; }
    isCharacterDevice() { return false; }
    isSymbolicLink() { return false; }
    isFIFO() { return false; }
    isSocket() { return false; }
  }

  class Dirent {
    constructor(name, kind) {
      this.name = name;
      this.kind = kind;
    }
    isFile() { return this.kind === "file"; }
    isDirectory() { return this.kind === "directory"; }
    isSymbolicLink() { return false; }
  }

  function tosegments(path) {
    const segs = String(path == null ? "" : path).split("/");
    const out = [];
    for (const s of segs) {
      if (s === "" || s === ".")
        continue;
      if (s === "..")
        throw ENOSYS(path + ": '..' tillåts ej");
      out.push(s);
    }
    return out;
  }

  function mkError(code, path) {
    const e = new Error(code + ": " + path);
    e.code = code;
    return e;
  }

  const ENOENT = path => mkError("ENOENT", path);
  const ENOTDIR = path => mkError("ENOTDIR", path);
  const EISDIR = path => mkError("EISDIR", path);
  const ENOSYS = path => mkError("ENOSYS", path);

  function normErr(err, path) {
    if (err && typeof err.code === "string")
      return err;
    const name = (err && err.name) || "";
    if (name === "NotFoundError")
      return ENOENT(path);
    if (name === "TypeMismatchError" || name === "NotSupportedError" || name === "TypeError")
      return ENOTDIR(path);
    if (name === "InvalidModificationError" || name === "NoModificationAllowedError")
      return mkError("EACCES", path);
    if (name === "QuotaExceededError")
      return mkError("ENOSPC", path);
    return err;
  }

  function create(rootHandle) {
    // Resolve OPFS-handles längs path. Returns {parent, name, handle|null}
    async function resolveHandle(segs, createDirs) {
      if (segs.length === 0)
        return { parent: null, name: null, handle: rootHandle };
      let cur = rootHandle;
      for (let i = 0; i < segs.length - 1; i++) {
        cur = await cur.getDirectoryHandle(segs[i], { create: createDirs });
      }
      const name = segs[segs.length - 1];
      let handle = null;
      try {
        handle = await cur.getFileHandle(name);
      } catch (e) {
        // If it's a directory (TypeMismatchError) or not found, try getDirectoryHandle
        if (e && (e.name === "TypeMismatchError" || e.name === "TypeError" || e.name === "NotFoundError")) {
          try {
            handle = await cur.getDirectoryHandle(name);
          } catch (e2) {
            handle = null;
          }
        } else {
          throw e;
        }
      }
      if (!handle && createDirs)
        handle = await cur.getDirectoryHandle(name, { create: true });
      return { parent: cur, name, handle };
    }

    const fs = {
      async readFile(filepath, opts) {
        try {
          const segs = tosegments(filepath);
          const { handle } = await resolveHandle(segs, false);
          if (!handle)
            throw ENOENT(filepath);
          const file = await handle.getFile();
          const buf = new Uint8Array(await file.arrayBuffer());
          if (opts && opts.encoding === "utf8")
            return new TextDecoder().decode(buf);
          return buf;
        } catch (e) { throw normErr(e, filepath); }
      },

      async writeFile(filepath, content, opts) {
        try {
          const segs = tosegments(filepath);
          if (segs.length === 0)
            throw ENOENT(filepath);
          let cur = rootHandle;
          for (let i = 0; i < segs.length - 1; i++)
            cur = await cur.getDirectoryHandle(segs[i], { create: true });
          const handle = await cur.getFileHandle(segs[segs.length - 1], { create: true });
          let bytes = content;
          if (typeof content === "string")
            bytes = new TextEncoder().encode(content);
          const writable = await handle.createWritable();
          await writable.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
          await writable.close();
        } catch (e) { throw normErr(e, filepath); }
      },

      async unlink(filepath) {
        try {
          const segs = tosegments(filepath);
          if (segs.length === 0)
            throw ENOENT(filepath);
          let cur = rootHandle;
          for (let i = 0; i < segs.length - 1; i++)
            cur = await cur.getDirectoryHandle(segs[i]);
          try {
            await cur.removeEntry(segs[segs.length - 1]);
          } catch (e) {
            throw ENOENT(filepath);
          }
        } catch (e) { throw normErr(e, filepath); }
      },

      async readdir(filepath, opts) {
        try {
          const segs = tosegments(filepath);
          const { handle } = await resolveHandle(segs, false);
          if (!handle)
            throw ENOENT(filepath);
          const names = [];
          const dirents = [];
          for await (const entry of handle.values()) {
            names.push(entry.name);
            if (opts && opts.withFileTypes)
              dirents.push(new Dirent(entry.name, entry.kind));
          }
          names.sort();
          if (opts && opts.withFileTypes)
            return dirents;
          return names;
        } catch (e) { throw normErr(e, filepath); }
      },

      async mkdir(filepath, opts) {
        try {
          const segs = tosegments(filepath);
          if (segs.length === 0)
            return;
          // OPFS getDirectoryHandle(create:true) är idempotent,
          // så mkdir skapar hela kedjan utan EEXIST-fel.
          let cur = rootHandle;
          for (let i = 0; i < segs.length; i++)
            cur = await cur.getDirectoryHandle(segs[i], { create: true });
        } catch (e) { throw normErr(e, filepath); }
      },

      async rmdir(filepath, opts) {
        try {
          const segs = tosegments(filepath);
          if (segs.length === 0)
            return;
          let cur = rootHandle;
          for (let i = 0; i < segs.length - 1; i++)
            cur = await cur.getDirectoryHandle(segs[i]);
          try {
            await cur.removeEntry(segs[segs.length - 1], opts && opts.recursive ? { recursive: true } : undefined);
          } catch (e) {
            throw ENOENT(filepath);
          }
        } catch (e) { throw normErr(e, filepath); }
      },

      async stat(filepath) {
        try {
          const segs = tosegments(filepath);
          const { handle } = await resolveHandle(segs, false);
          if (!handle)
            throw ENOENT(filepath);
          if (handle.kind === "directory")
            return new Stats("dir", 0, 0, DIR_MODE);
          const file = await handle.getFile();
          return new Stats("file", file.size, file.lastModified, FILE_MODE);
        } catch (e) { throw normErr(e, filepath); }
      },

      async lstat(filepath) {
        return fs.stat(filepath);
      },

      async readlink() {
        throw ENOSYS("readlink finns inte i OPFS");
      },

      async symlink() {
        throw ENOSYS("symlink finns inte i OPFS");
      },

      // isomorphic-git använder exists() som bekvämlighet (LightningFS-API)
      async exists(filepath) {
        try {
          await fs.stat(filepath);
          return true;
        } catch (e) {
          if (e && e.code === "ENOENT")
            return false;
          throw e;
        }
      }
    };

    return fs;
  }

  globalThis.AiProffsGitFS = { create };
})();