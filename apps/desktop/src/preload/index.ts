import { contextBridge, ipcRenderer } from "electron";

import { isRecord } from "@repo/features/ipc";

// Bootstrap-only preload: the Bridge itself is a WebSocket client the
// renderer constructs (ws-bridge). The ws endpoint + per-boot local token are
// fetched from main over a one-shot synchronous IPC call — a BOOTSTRAP shell
// channel, not a Bridge data channel (the Bridge data plane stays WS-only).
// sendSync (instead of additionalArguments) keeps the token off the renderer
// process's OS command line — argv is readable by every local user via `ps` —
// and out of the page URL / navigation history.
const raw: unknown = ipcRenderer.sendSync("inteligir:bootstrap");

if (isRecord(raw) && typeof raw["url"] === "string" && typeof raw["token"] === "string") {
  contextBridge.exposeInMainWorld("bridgeBootstrap", { url: raw["url"], token: raw["token"] });
}
