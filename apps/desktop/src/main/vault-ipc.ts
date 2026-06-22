import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";

import { handle } from "@/main/lib/ipc-handler";
import { getVaultManager } from "@/main/vault";
import { toErrorMessage } from "@/shared/ipc";

export function registerVaultIpcHandlers(): void {
  // ---- Trusted surface (Vault panel) ----------------------------------------

  handle("getVaultRoot", () => getVaultManager().getRoot());

  handle("chooseVaultRoot", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title: "Choose vault folder",
      defaultPath: getVaultManager().getRoot(),
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const chosen = result.filePaths[0];
    if (result.canceled || chosen === undefined) return { canceled: true };
    getVaultManager().setRoot(chosen);
    return { root: getVaultManager().getRoot() };
  });

  handle("listVault", () => getVaultManager().list());
  handle("readVaultDoc", ({ path }) => getVaultManager().readText(path));
  handle("writeVaultDoc", ({ path, content }) => {
    getVaultManager().writeText(path, content);
  });
  handle("deleteVaultEntry", ({ path }) => ({ removed: getVaultManager().delete(path) }));

  // ---- Widget surface (envelope results, never throws to the renderer) -------

  handle("widgetVaultRead", ({ path }) => {
    try {
      return { ok: true as const, value: getVaultManager().readAuto(path) };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });

  handle("widgetVaultWrite", ({ path, value }) => {
    try {
      getVaultManager().writeAuto(path, value);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });
}
