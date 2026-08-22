// The browser CHROME BAR's preload — the one preload in this process, and it
// bridges only the shell's own bundled chrome page (browser-chrome.html) to
// the main process. The app window and the web CONTENT view load no preload
// at all, so neither ever sees an ipcRenderer. The surface is fixed verbs:
// nothing here takes a channel name, a path, or anything but the URL-bar text.

import { contextBridge, ipcRenderer } from "electron";

export interface BrowserChromeState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface SendToAgentResult {
  ok: boolean;
  detail: string;
}

const api = {
  navigate(input: string): void {
    void ipcRenderer.invoke("inteligir-browser:navigate", input);
  },
  back(): void {
    void ipcRenderer.invoke("inteligir-browser:back");
  },
  forward(): void {
    void ipcRenderer.invoke("inteligir-browser:forward");
  },
  reload(): void {
    void ipcRenderer.invoke("inteligir-browser:reload");
  },
  async sendToAgent(): Promise<SendToAgentResult> {
    const result: unknown = await ipcRenderer.invoke("inteligir-browser:send-to-agent");
    // The bridge does not trust shapes across the boundary either way.
    if (
      typeof result === "object" &&
      result !== null &&
      "ok" in result &&
      typeof result.ok === "boolean" &&
      "detail" in result &&
      typeof result.detail === "string"
    ) {
      return { ok: result.ok, detail: result.detail };
    }
    return { ok: false, detail: "malformed shell response" };
  },
  onState(listener: (state: BrowserChromeState) => void): void {
    ipcRenderer.on("inteligir-browser:state", (_event, state: BrowserChromeState) => {
      listener(state);
    });
  },
};

contextBridge.exposeInMainWorld("inteligirBrowser", api);

export type InteligirBrowserApi = typeof api;
