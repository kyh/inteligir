import { existsSync } from "node:fs";
import path from "node:path";

import { app, BrowserWindow, shell } from "electron";
import type { WebContents } from "electron";

import { APP_ORIGIN_ARG } from "../shared/bridge";
import { classify, opensExternally, reloadTarget, savePathOf } from "./navigation";

const openExternally = async (url: string) => {
  try {
    await shell.openExternal(url);
  } catch (error: unknown) {
    console.error(`[desktop] could not open ${url} in the browser`, error);
  }
};

const load = async (window: BrowserWindow, url: string) => {
  try {
    await window.loadURL(url);
  } catch (error: unknown) {
    console.error(`[desktop] could not load ${url}`, error);
  }
};

/**
 * Pins every web contents the app creates to the site (`navigation.ts`): no page gets a second
 * window, a webview or a device permission (dictation is the operating system's, so the page needs
 * no microphone), and a file the page saves lands in Downloads.
 */
export const pinNavigation = (appUrl: string) => {
  const guard = (event: Electron.Event<{ isMainFrame: boolean; url: string }>) => {
    const verdict = classify(event.url, appUrl);

    if (verdict === "allow") {
      return;
    }

    event.preventDefault();

    if (event.isMainFrame && verdict === "open-externally") {
      void openExternally(event.url);
    }
  };

  app.on("web-contents-created", (_event, contents: WebContents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (opensExternally(url)) {
        void openExternally(url);
      }

      return { action: "deny" };
    });
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    contents.on("will-frame-navigate", guard);
    contents.on("will-redirect", guard);
    contents.session.setPermissionRequestHandler((_contents, _permission, answer) => {
      answer(false);
    });
    contents.session.setPermissionCheckHandler(() => false);
  });

  app.on("session-created", (session) => {
    session.on("will-download", (_event, item) => {
      item.setSavePath(savePathOf(app.getPath("downloads"), item.getFilename(), existsSync));
    });
  });
};

interface WindowOptions {
  appUrl: string;
  quitting: () => boolean;
  title: string;
}

/**
 * The one window, on the site's library tab. On a Mac closing it hides it, so the tab keeps its
 * state; on Windows, with no dock to bring it back, closing it quits.
 */
export const createMainWindow = ({ appUrl, quitting, title }: WindowOptions) => {
  const window = new BrowserWindow({
    height: 800,
    minHeight: 600,
    minWidth: 800,
    show: false,
    title,
    webPreferences: {
      additionalArguments: [`${APP_ORIGIN_ARG}${new URL(appUrl).origin}`],
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
    },
    width: 1200,
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
  });
  window.once("ready-to-show", () => {
    window.show();
  });
  window.on("close", (event) => {
    if (process.platform === "darwin" && !quitting()) {
      event.preventDefault();
      window.hide();
    }
  });

  void load(window, appUrl);

  return window;
};

/** Brings the window forward. */
export const showWindow = (window: BrowserWindow) => {
  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
};

/** View › Reload, which never leaves the site. */
export const reloadWindow = (window: BrowserWindow, appUrl: string) => {
  if (reloadTarget(window.webContents.getURL(), appUrl) === "shown") {
    window.webContents.reload();

    return;
  }

  void load(window, appUrl);
};
