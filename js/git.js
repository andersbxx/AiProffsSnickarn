(function () {
  "use strict";

  const AUTHOR = { name: "AiProffsSnickarn", email: "snickarn@local" };
  const DEFAULT_BRANCH = "main";

  const repos = new Map();

  function gitLib() {
    if (!globalThis.git || typeof globalThis.git.init !== "function")
      throw new Error("isomorphic-git är inte laddad");
    return globalThis.git;
  }

  async function repo(id) {
    if (!repos.has(id)) {
      const dirHandle = await AiProffsStorage.getDir(id, true);
      repos.set(id, { fs: AiProffsGitFS.create(dirHandle), dir: "" });
    }
    return repos.get(id);
  }

  function forget(id) {
    repos.delete(id);
  }

  async function hasHead(fs) {
    const git = gitLib();
    try {
      await git.resolveRef({ fs, dir: "", ref: "HEAD" });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function ensure(id) {
    const { fs } = await repo(id);
    const git = gitLib();
    await git.init({ fs, dir: "", defaultBranch: DEFAULT_BRANCH });
    return { fs, dir: "" };
  }

  async function changedFiles(id, filepaths) {
    const { fs } = await repo(id);
    const git = gitLib();
    const fp = filepaths && filepaths.length ? filepaths : ["."];
    const rows = await git.statusMatrix({ fs, dir: "", filepaths: fp });
    const adds = [];
    const removes = [];
    for (const row of rows) {
      const [path, head, workdir, stage] = row;
      if (head === workdir && workdir === stage)
        continue;
      if (workdir === 0)
        removes.push(path);
      else
        adds.push(path);
    }
    return { adds, removes };
  }

  async function commitAll(id, message, filepaths) {
    await ensure(id);
    const { fs, dir } = await repo(id);
    const git = gitLib();
    let adds = [];
    let removes = [];
    if (await hasHead(fs)) {
      const changed = await changedFiles(id, filepaths);
      adds = changed.adds;
      removes = changed.removes;
    } else {
      adds = filepaths && filepaths.length ? filepaths : await AiProffsStorage.listFiles(id);
    }
    if (adds.length === 0 && removes.length === 0)
      return null;
    if (adds.length > 0)
      await git.add({ fs, dir, filepath: adds });
    for (const path of removes)
      await git.remove({ fs, dir, filepath: path });
    const oid = await git.commit({
      fs,
      dir,
      message,
      author: AUTHOR,
      committer: AUTHOR
    });
    return oid;
  }

  async function log(id, depth) {
    await ensure(id);
    const { fs, dir } = await repo(id);
    const git = gitLib();
    if (!(await hasHead(fs)))
      return [];
    const commits = await git.log({ fs, dir, depth: depth || 20 });
    return commits.map(c => ({
      oid: c.oid,
      message: c.commit.message.trim(),
      timestamp: c.commit.committer.timestamp * 1000,
      author: c.commit.author.name
    }));
  }

  async function count(id) {
    return (await log(id, 1000)).length;
  }

  globalThis.AiProffsGit = {
    ensure,
    commitAll,
    log,
    count,
    forget
  };
})();