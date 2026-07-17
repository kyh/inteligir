// ---------------------------------------------------------------------------
// The Electron implementation of HostPlatform. Every electron API the host
// logic needs lives behind this object; the host library itself never
// imports electron.
// ---------------------------------------------------------------------------

import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Notification,
  safeStorage,
  shell,
  type OpenDialogOptions,
} from "electron";

import type { HostNotification, HostPlatform } from "@repo/features/server/platform";

declare const PROJECT_ROOT: string;

export type ElectronPlatform = {
  platform: HostPlatform;
  /**
   * The window notification activation should focus. Registered explicitly so
   * we don't rely on BrowserWindow.getAllWindows()[0], whose ordering Electron
   * does not guarantee — auxiliary windows (devtools, about panels) could
   * otherwise be targeted instead of the main app window.
   */
  setTargetWindow: (window: BrowserWindow) => void;
};

export function createElectronPlatform(): ElectronPlatform {
  let targetWindow: BrowserWindow | null = null;

  function focusTargetWindow(): void {
    const win = targetWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  const platform: HostPlatform = {
    userDataDir: app.getPath("userData"),

    // Packaged: electron-builder copies packages/features/resources/agent into
    // Contents/Resources/agent (extraResources). Dev: read the workspace copy.
    resourcesDir: app.isPackaged
      ? path.join(process.resourcesPath, "agent")
      : path.resolve(PROJECT_ROOT, "../../packages/features/resources/agent"),

    // A packaged install missing its resources is corrupt — fail loudly.
    strictResources: app.isPackaged,

    secretCipher: {
      kind: "safe-storage",
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString("base64"),
      decrypt: (data) => safeStorage.decryptString(Buffer.from(data, "base64")),
    },

    openExternal: (url) => shell.openExternal(url),

    // Rejects where the OS has no trash (some Linux setups) — the vault layer
    // falls back to a permanent remove.
    trashItem: (absolutePath) => shell.trashItem(absolutePath),

    pickDirectory: async ({ title, defaultPath }) => {
      const win = BrowserWindow.getFocusedWindow();
      const options: OpenDialogOptions = {
        title,
        defaultPath,
        properties: ["openDirectory", "createDirectory"],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      const chosen = result.filePaths[0];
      if (result.canceled || chosen === undefined) return null;
      return chosen;
    },

    notify: (notification: HostNotification) => {
      // `typeof` guard: in non-Electron environments (vitest) a mocked
      // electron module may not export Notification at all.
      if (typeof Notification !== "function" || !Notification.isSupported()) return;
      const native = new Notification({
        title: notification.title,
        body: notification.body,
        silent: false,
      });
      native.on("click", () => {
        focusTargetWindow();
        notification.onActivate?.();
      });
      native.show();
    },

    anyUiFocused: () => {
      // Fast-path the common "main window is focused → suppress" case before
      // scanning every window. The scan still runs when the main window is
      // unfocused, since auxiliary windows (devtools, etc) also count as
      // "the app is in the foreground" from the user's POV.
      if (targetWindow && !targetWindow.isDestroyed() && targetWindow.isFocused()) return true;
      return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
    },
  };

  return {
    platform,
    setTargetWindow: (window) => {
      targetWindow = window;
      window.on("closed", () => {
        if (targetWindow === window) targetWindow = null;
      });
    },
  };
}
