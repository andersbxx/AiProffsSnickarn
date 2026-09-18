"""Vendora CodeMirror 6 (och dess graf) som lokala ES-moduler med bare-specifier
imports, för användning via en importmap i index.html. Ingen build-step.

Laddar varje pakets module-fält (eller dist/index.js) från unpkg,
utforskar imports rekursivt, skriver filer till vendor/cm/ och
generar vendor/cm/importmap.json.
"""
import json
import os
import re
import sys
import urllib.request

UNPKG = "https://unpkg.com"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "cm")

# Baserade på npm-registry-fakta:
# @codemirror/lang-c existerar INTE — paketet heter @codemirror/lang-cpp.
# style-mod module-fält pekar på src/style-mod.js, inte dist/index.js.
# @lezer/c existerar INTE — paketet heter @lezer/cpp.
PINNED = {
    "@codemirror/state": "6.7.4",
    "@codemirror/view": "6.43.11",
    "@codemirror/commands": "6.11.0",
    "@codemirror/language": "6.11.0",
    "@codemirror/autocomplete": "6.20.3",
    "@codemirror/search": "6.7.2",
    "@codemirror/lint": "6.9.7",
    "@codemirror/lang-cpp": "6.0.3",
    "@lezer/common": "1.2.3",
    "@lezer/lr": "1.4.10",
    "@lezer/highlight": "1.2.1",
    "@lezer/cpp": "1.1.6",
    "style-mod": "4.1.3",
    "w3c-keyname": "2.2.8",
    "crelt": "1.0.6",
    "@marijn/find-cluster-break": "1.0.4",
}

FALLBACK_CANDIDATES = [
    "dist/index.js",
    "dist/index.mjs",
    "lib/index.js",
    "src/index.js",
    "index.js",
]

IMPORT_RE = re.compile(
    r"""(?:import|export)(?:[\s\S]*?)\bfrom\s*["'](?P<mod>[^"']+)["']|import\s*["'](?P<imp>[^"']+)["']""",
    re.M,
)


def fetch(path):
    with urllib.request.urlopen(UNPKG + path, timeout=60) as r:
        return r.read().decode("utf-8")


def get_entry(name, version):
    pkg_json_url = "/%s@%s/package.json" % (name, version)
    try:
        pkg = json.loads(fetch(pkg_json_url))
    except Exception as e:
        print("    WARN kunde inte hämta package.json för %s: %s" % (name, e))
        pkg = {}

    # hämta module-fält eller exports.import
    module_rel = pkg.get("module")
    if not module_rel and isinstance(pkg.get("exports"), dict):
        imp = pkg["exports"].get("import")
        if isinstance(imp, str):
            module_rel = imp
    candidates = []
    if module_rel:
        candidates.append(module_rel)
    for c in FALLBACK_CANDIDATES:
        if c not in candidates:
            candidates.append(c)

    for cand in candidates:
        try:
            return (cand, fetch("/%s@%s/%s" % (name, version, cand)))
        except Exception:
            continue
    return (None, None)


def scan_imports(code):
    found = set()
    for m in IMPORT_RE.finditer(code):
        spec = m.group("mod") or m.group("imp")
        if not spec:
            continue
        if spec.startswith(".") or spec.startswith("/"):
            continue
        if spec.startswith("node:"):
            continue
        found.add(spec)
    return found


def main():
    os.makedirs(OUT, exist_ok=True)

    queue = list(PINNED.keys())
    done = {}
    ordered = []
    seen_imports = set()

    while queue:
        name = queue.pop(0)
        if name in done:
            continue
        version = PINNED.get(name)
        if not version:
            print("  VILLKORSAKNAD version för %s — hoppar" % name)
            continue
        print("  hämtar %s@%s" % (name, version))
        entry, code = get_entry(name, version)
        if code is None:
            print("    FEL: kunde inte hämta entry för %s@%s" % (name, version))
            continue
        done[name] = (version, entry, code)
        ordered.append(name)
        for dep in scan_imports(code):
            if dep not in done:
                queue.append(dep)

    # skriv filer och importmap
    importmap = {}
    for name in ordered:
        (version, entry, code) = done[name]
        out_name = name.replace("@", "").replace("/", "_") + ".mjs"
        out_path = os.path.join(OUT, out_name)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("/* %s@%s (vendored, %s) */\n" % (name, version, entry))
            f.write(code)
        importmap[name] = "./vendor/cm/" + out_name
        print("  -> %s -> %s" % (name, out_name))

    with open(os.path.join(OUT, "importmap.json"), "w", encoding="utf-8") as f:
        json.dump({"imports": importmap}, f, indent=2)

    print("klar — %d paket laddade" % len(ordered))
    return importmap


if __name__ == "__main__":
    main()