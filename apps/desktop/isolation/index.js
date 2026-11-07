// The isolation app (https://v2.tauri.app/concept/inter-process-communication/isolation/): every
// message the page sends the shell passes through this hook, in a sandboxed frame no script of the
// page's can reach, before Tauri encrypts it. The shell checks each command's arguments itself, so
// the hook hands every message on as it came. A classic script: the frame loads no module.
window.__TAURI_ISOLATION_HOOK__ = (payload) => payload;
