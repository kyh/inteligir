// preload for the chrome bar only; the web content view loads no preload.

import { contextBridge, ipcRenderer } from "electron";
import { BROWSER_IPC } from "./browser-ipc";

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
    void ipcRenderer.invoke(BROWSER_IPC.NAVIGATE, input);
  },
  back(): void {
    void ipcRenderer.invoke(BROWSER_IPC.BACK);
  },
  forward(): void {
    void ipcRenderer.invoke(BROWSER_IPC.FORWARD);
  },
  reload(): void {
    void ipcRenderer.invoke(BROWSER_IPC.RELOAD);
  },
  async sendToAgent(): Promise<SendToAgentResult> {
    const result: unknown = await ipcRenderer.invoke(BROWSER_IPC.SEND_TO_AGENT);
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
    ipcRenderer.on(BROWSER_IPC.STATE, (_event, state: BrowserChromeState) => {
      listener(state);
    });
  },
};

contextBridge.exposeInMainWorld("inteligirBrowser", api);

export type InteligirBrowserApi = typeof api;
