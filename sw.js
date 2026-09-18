"use strict";

const CACHE_NAME = "aiproffs-v1";

// App-shell + runtime + CodeMirror. Kompilatorn (tcc.wasm, wabt.js) precachas INTE.
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/storage.js",
  "./js/gitfs.js",
  "./js/git.js",
  "./js/editor.js",
  "./js/compiler.js",
  "./js/ai.js",
  "./js/ai-panel.js",
  "./vendor/buffer.min.js",
  "./vendor/isomorphic-git.min.js",
  "./vendor/runtime.js",
  "./vendor/ide-resources.js",
  "./vendor/libc.wasm",
  "./vendor/cm/importmap.json",
  "./vendor/cm/codemirror_autocomplete.mjs",
  "./vendor/cm/codemirror_commands.mjs",
  "./vendor/cm/codemirror_lang-cpp.mjs",
  "./vendor/cm/codemirror_language.mjs",
  "./vendor/cm/codemirror_lint.mjs",
  "./vendor/cm/codemirror_search.mjs",
  "./vendor/cm/codemirror_state.mjs",
  "./vendor/cm/codemirror_view.mjs",
  "./vendor/cm/crelt.mjs",
  "./vendor/cm/lezer_common.mjs",
  "./vendor/cm/lezer_cpp.mjs",
  "./vendor/cm/lezer_highlight.mjs",
  "./vendor/cm/lezer_lr.mjs",
  "./vendor/cm/marijn_find-cluster-break.mjs",
  "./vendor/cm/style-mod.mjs",
  "./vendor/cm/w3c-keyname.mjs",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET")
    return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin)
    return;
  const path = url.pathname;
  if (path.endsWith("/sw.js"))
    return;

  const isPrecached = PRECACHE.some(p => {
    const pUrl = new URL(p, self.location.href);
    return pUrl.pathname === path;
  });

  if (isPrecached) {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Lazy-loadade stora resurser (tcc.wasm, wabt.js): network-first, fallback till cache.
  event.respondWith(
    fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request))
  );
});