// ---------------------------------------------------------------------------
// HTML App runtime — the tiny bridge the host injects into every vault `.html`
// app before it runs. It exposes `window.inteligir.files`, a postMessage RPC to
// the host (the app renders in a sandboxed iframe with NO allow-same-origin, so
// it can never touch the host bridge directly — this is the only channel).
//
// Vanilla ES5-ish, no deps. Loaded synchronously in <head> before app code, so
// `window.inteligir` exists by the time the app runs.
//
// Wire protocol (this file and the renderer-side broker MUST agree):
//   request : { type: "inteligir:request",  id, token, method, args }
//   response: { type: "inteligir:response", id, ok, value?, error? }
//   height  : { type: "inteligir:height",   token, height }
// The token is this frame's `window.name` — the per-open token the host minted;
// the broker rejects any message whose token doesn't match the frame it set.
// ---------------------------------------------------------------------------

(function () {
  var TOKEN = window.name;
  var TIMEOUT_MS = 10000;
  var pending = Object.create(null); // id -> { resolve, reject, timer }
  var seq = 0;

  window.addEventListener("message", function (event) {
    // Responses only ever come from our parent (the host renderer).
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg.type !== "inteligir:response" || typeof msg.id !== "string") return;
    var entry = pending[msg.id];
    if (!entry) return;
    delete pending[msg.id];
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.value);
    else entry.reject(new Error(typeof msg.error === "string" ? msg.error : "request failed"));
  });

  function request(method, args) {
    return new Promise(function (resolve, reject) {
      var id = TOKEN + ":" + ++seq;
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error("inteligir." + method + " timed out"));
      }, TIMEOUT_MS);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      // targetOrigin "*" — a sandboxed frame has an opaque origin, so a specific
      // target can never match. The broker authenticates by frame + token, not
      // origin, and the payload only ever carries the app's own vault data.
      window.parent.postMessage(
        { type: "inteligir:request", id: id, token: TOKEN, method: method, args: args },
        "*",
      );
    });
  }

  function makeSafe(fn) {
    return function () {
      var args = arguments;
      return Promise.resolve()
        .then(function () {
          return fn.apply(null, args);
        })
        .then(
          function (value) {
            return { ok: true, value: value };
          },
          function (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          },
        );
    };
  }

  var files = {
    // list()                       → every doc as { path, name }
    // list({ query, withProperties, limit }) → ranked hits (with snippets when
    //   query is set) capped at `limit` (default 50, max 200); withProperties
    //   attaches each hit's parsed frontmatter as `properties`.
    list: function (options) {
      return request("list", options === undefined ? [] : [options]);
    },
    read: function (path) {
      return request("read", [path]);
    },
    open: function (path) {
      return request("open", [path]);
    },
    create: function (path, doc) {
      return request("create", [path, doc]);
    },
    update: function (path, patch) {
      return request("update", [path, patch]);
    },
    remove: function (path) {
      return request("remove", [path]);
    },
    // Source paths of notes that link TO `path` (wiki + markdown links), deduped.
    backlinks: function (path) {
      return request("backlinks", [path]);
    },
  };
  // Non-throwing variants: safeList, safeRead, … → { ok, value | error }.
  ["list", "read", "open", "create", "update", "remove", "backlinks"].forEach(function (name) {
    files["safe" + name.charAt(0).toUpperCase() + name.slice(1)] = makeSafe(files[name]);
  });

  window.inteligir = { files: files };

  // Content-height reporting (unused by the standalone app view today; the
  // inline-embed follow-up consumes it to size an embedded app to its content).
  function postHeight() {
    var h = Math.ceil(document.documentElement.scrollHeight);
    window.parent.postMessage({ type: "inteligir:height", token: TOKEN, height: h }, "*");
  }
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(postHeight).observe(document.documentElement);
  }
  window.addEventListener("load", postHeight);
})();
