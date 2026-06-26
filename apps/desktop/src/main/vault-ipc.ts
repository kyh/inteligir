import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";

import { handle } from "@/main/lib/ipc-handler";
import { getVaultManager } from "@/main/vault";
import { toErrorMessage } from "@/shared/ipc";
import type { ChooseVaultResult } from "@/shared/ipc-registry";

export function registerVaultIpcHandlers(): void {
  // ---- Trusted surface (Vault panel) ----------------------------------------

  handle("getVaultRoot", () => getVaultManager().getRoot());

  handle("chooseVaultRoot", async (): Promise<ChooseVaultResult> => {
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
    try {
      // setRoot rejects a folder inside ~/.inteligir (wiped on logout).
      getVaultManager().setRoot(chosen);
    } catch (err) {
      return { error: toErrorMessage(err) };
    }
    return { root: getVaultManager().getRoot() };
  });

  handle("listVault", () => getVaultManager().list());
  handle("readVaultDoc", ({ path }) => getVaultManager().readText(path));
  handle("writeVaultDoc", ({ path, content }) => {
    getVaultManager().writeText(path, content);
  });
  handle("deleteVaultEntry", ({ path }) => ({ removed: getVaultManager().delete(path) }));
}
