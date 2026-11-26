import { existsSync } from "node:fs";
import path from "node:path";

import { app, dialog, ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

import { channelOf, COMMANDS } from "../shared/bridge";
import type { BridgeEvent, Command, EventPayloads, UpdateState } from "../shared/bridge";
import { installMenu } from "./menu";
import { createUpdater } from "./updater";
import { createMainWindow, pinNavigation, reloadWindow, showWindow } from "./window";

const development = !app.isPackaged;
const APP_NAME = development ? "Inteligir (Dev)" : "Inteligir";
const SITE_URL = development ? "http://localhost:5174/library" : "https://inteligir.com/library";
const siteOrigin = new URL(SITE_URL).origin;

let mainWindow: BrowserWindow | null = null;
let quitting = false;

const showsSite = (window: BrowserWindow) => {
  try {
    return new URL(window.webContents.getURL()).origin === siteOrigin;
  } catch {
    return false;
  }
};

const send = <E extends BridgeEvent>(event: E, payload: EventPayloads[E]) => {
  if (mainWindow && !mainWindow.isDestroyed() && showsSite(mainWindow)) {
    mainWindow.webContents.send(channelOf(event), payload);
  }
};

const isFromSite = (event: IpcMainInvokeEvent) => {
  const frame = event.senderFrame;

  return (
    frame !== null &&
    frame.parent === null &&
    frame.origin === siteOrigin &&
    mainWindow !== null &&
    event.sender === mainWindow.webContents
  );
};

const updater = createUpdater(
  app.isPackaged && existsSync(path.join(process.resourcesPath, "app-update.yml")),
  (state: UpdateState) => {
    send("update-state", state);
  },
  (installing: boolean) => {
    quitting = installing;
  },
);

const answers = {
  "check-for-updates": updater.check,
  "download-update": updater.download,
  "install-update": updater.install,
} satisfies Record<Command, () => Promise<UpdateState> | UpdateState>;

const start = async () => {
  app.enableSandbox();
  app.setName(APP_NAME);

  if (development) {
    app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();

    return;
  }

  pinNavigation(SITE_URL);
  app.on("before-quit", () => {
    quitting = true;
  });
  await app.whenReady();

  for (const command of COMMANDS) {
    ipcMain.handle(channelOf(command), async (event) => {
      if (!isFromSite(event)) {
        throw new Error(`${command} is answered only for the site`);
      }

      return await answers[command]();
    });
  }

  installMenu(() => {
    if (mainWindow) {
      reloadWindow(mainWindow, SITE_URL);
    }
  });

  mainWindow = createMainWindow({ appUrl: SITE_URL, quitting: () => quitting, title: APP_NAME });

  const reveal = () => {
    if (mainWindow) {
      showWindow(mainWindow);
    }
  };

  app.on("activate", reveal);
  app.on("second-instance", reveal);
};

const run = async () => {
  try {
    await start();
  } catch (error: unknown) {
    console.error("[desktop] Inteligir failed to start", error);
    dialog.showErrorBox(`${APP_NAME} failed to start`, String(error));
    app.exit(1);
  }
};

void run();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.quit();
  });
}
