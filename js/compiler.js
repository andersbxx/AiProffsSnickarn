(function () {
  "use strict";

  const VENDOR = "./vendor/";

  const WAT_FEATURES = {
    exceptions: true,
    mutable_globals: true,
    sat_float_to_int: true,
    sign_extension: true,
    multi_value: true,
    bulk_memory: true,
    reference_types: true
  };

  let bootPromise = null;
  let compilerHost = null;
  let appRuntime = null;
  let wabt = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.querySelectorAll("script")).find(s =>
        s.src === new URL(src, location.href).href
      );
      if (existing && existing.__loaded) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.addEventListener("load", () => {
        s.__loaded = true;
        resolve();
      });
      s.addEventListener("error", () => {
        reject(new Error("Kunde inte ladda " + src));
        s.remove();
      });
      document.head.appendChild(s);
    });
  }

  function ensureBooted() {
    if (!bootPromise) {
      bootPromise = (async () => {
        await Promise.all([
          loadScript(VENDOR + "ide-resources.js"),
          loadScript(VENDOR + "runtime.js"),
          loadScript(VENDOR + "wabt.js")
        ]);
        [compilerHost, appRuntime] = await Promise.all([
          TccWasmRuntime.CompilerHost.create({
            wasm: VENDOR + "tcc.wasm",
            libc: VENDOR + "libc.wasm",
            resources: TccWasmIdeResources
          }),
          TccWasmRuntime.AppRuntime.create({ libc: VENDOR + "libc.wasm" })
        ]);
        wabt = await globalThis.WabtModule();
      })();
    }
    return bootPromise;
  }

  async function compileAndRun(source, stdin) {
    await ensureBooted();

    let compile;
    try {
      compile = compilerHost.compileAppResult(source);
    } catch (err) {
      return {
        ok: false,
        rc: 1,
        stdout: "",
        stderr: "",
        diagnostics: String(err && err.message ? err.message : err)
      };
    }
    if (compile.rc !== 0) {
      return {
        ok: false,
        rc: compile.rc,
        stdout: "",
        stderr: "",
        diagnostics: (compile.diagnostics || "").trim()
      };
    }

    const watMod = wabt.parseWat("input.wat", compile.wat, WAT_FEATURES);
    let binary;
    try {
      watMod.resolveNames();
      watMod.validate();
      binary = watMod.toBinary({ write_debug_names: true }).buffer;
    } catch (err) {
      return {
        ok: false,
        rc: 1,
        stdout: "",
        stderr: String(err && err.message ? err.message : err),
        diagnostics: (compile.diagnostics || "").trim()
      };
    } finally {
      watMod.destroy();
    }

    const run = await appRuntime.run(binary, { stdin: stdin || "" });
    return {
      ok: run.rc === 0 && !(run.stderr || "").trim(),
      rc: run.rc,
      stdout: run.stdout || "",
      stderr: run.stderr || "",
      diagnostics: (compile.diagnostics || "").trim()
    };
  }

  globalThis.AiProffsCompiler = { compileAndRun };
})();