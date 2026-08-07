// ---------------------------------------------------------------------------
// The Inteligir desktop shell.
//
// This process owns no vault, no agent and no index — the product runs at the
// deployment this shell wraps (app-url.ts), and everything below is the OS
// affordances a browser tab cannot give it: a dedicated window, the
// `inteligir://` scheme, a tray, a global shortcut to summon the window, and
// updates OF THE SHELL.
//
// What it must not become is a browser. The window loads exactly one origin
// and is pinned to it, and no popup is ever granted: a shell that can be
// navigated anywhere is a browser with the user's credentials in it, wearing
// the product's chrome. Those two rules (navigation-guard.ts) are the whole
// security surface of this process.
// ---------------------------------------------------------------------------

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from "electron";

import type { MenuItemConstructorOptions } from "electron";

import { resolveAppOrigin, workspaceUrl } from "@/main/app-url";
import { handleDeepLinkUrl, installDeepLinks, markDeepLinksReady } from "@/main/deep-link";
import { extractDeepLinkFromArgv } from "@/main/deep-link-route";
import {
  classifyNavigation,
  classifyWindowOpen,
  isPdfFrameMismatch,
} from "@/main/navigation-guard";
import { setupAutoUpdater, type Updater } from "@/main/updater";

declare const BUNDLED_APP_URL: string | undefined;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const isDevelopment = !app.isPackaged;
const APP_DISPLAY_NAME = isDevelopment ? "Inteligir (Dev)" : "Inteligir";

/** Summons the window from anywhere. Registration is best-effort — another app
 * may already hold it, and a shell that refused to start over a taken hotkey
 * would be trading the product for an accelerator. */
const SUMMON_SHORTCUT = "CommandOrControl+Alt+I";

// `typeof` guarded: the define does not exist when vitest runs this module's
// siblings from raw source.
const APP_ORIGIN = resolveAppOrigin({
  env: process.env["INTELIGIR_APP_URL"],
  bundled: typeof BUNDLED_APP_URL === "string" ? BUNDLED_APP_URL : undefined,
});

// inteligir:// deep links: the open-url listener must exist before `ready`
// (macOS delivers a cold launch's URL early); paths buffer until the window
// exists (markDeepLinksReady in onAppReady). See deep-link.ts.
installDeepLinks();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let updater: Updater | null = null;

process.on("uncaughtException", (error) => {
  console.error("[desktop] uncaught exception:", error);
  // Preserve Electron's default behavior (which our listener suppresses):
  // surface the error dialog and keep the app alive.
  dialog.showErrorBox(
    "A JavaScript error occurred in the main process",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
});

process.on("unhandledRejection", (reason) => {
  console.error("[desktop] unhandled rejection:", reason);
});

// ---------------------------------------------------------------------------
// App identity, menu and tray
// ---------------------------------------------------------------------------

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => void updater?.checkForUpdates(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [{ role: "close" }],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Tray icon, sized and marked as a template so macOS tints it for the menu
 * bar's own appearance instead of rendering the full-colour app icon. */
function createTray(): Tray | null {
  const icon = nativeImage
    .createFromPath(path.join(moduleDir, "../../../resources/icon.png"))
    .resize({ width: 16, height: 16 });
  if (icon.isEmpty()) {
    console.error("[desktop] tray icon missing — skipping the tray");
    return null;
  }
  icon.setTemplateImage(true);
  const created = new Tray(icon);
  created.setToolTip(APP_DISPLAY_NAME);
  created.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${APP_DISPLAY_NAME}`, click: () => showMainWindow() },
      {
        label: "Check for Updates...",
        click: () => void updater?.checkForUpdates(),
      },
      { type: "separator" },
      { role: "quit" },
    ]),
  );
  created.on("click", () => showMainWindow());
  return created;
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    // Pre-paint chrome, so the frame does not flash the wrong shade before the
    // page paints its own. The page owns the theme; this only guesses.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141415" : "#f0f2f2",
    autoHideMenuBar: true,
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler((details) => {
    if (classifyWindowOpen(details.url) === "deny-and-open-external") {
      void shell.openExternal(details.url);
    }
    return { action: "deny" };
  });

  // Top-level navigation is pinned to the deployment's origin — the
  // allow/block policy lives in navigation-guard.ts (pure and unit-tested);
  // these closures only wire its verdicts to webContents.
  const guardNavigation = (event: Electron.Event, url: string): void => {
    const verdict = classifyNavigation(url, APP_ORIGIN);
    if (verdict === "allow") return;
    event.preventDefault();
    if (verdict === "block-and-open-external") {
      void shell.openExternal(url);
    }
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);

  // A `.pdf` sub-frame that answers with something other than a PDF is
  // attacker markup in the one frame the editor cannot sandbox. Main sees the
  // real Content-Type, so it can confirm what the page could only guess from
  // the URL; the verdict itself is pure + unit-tested.
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {};
    const contentTypeKey = Object.keys(headers).find((key) => key.toLowerCase() === "content-type");
    const rawContentType = contentTypeKey === undefined ? undefined : headers[contentTypeKey]?.[0];
    if (
      isPdfFrameMismatch({
        url: details.url,
        resourceType: details.resourceType,
        contentType: rawContentType,
      })
    ) {
      console.warn(
        `[main] blocked a .pdf frame serving "${rawContentType ?? "?"}": ${details.url}`,
      );
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_DISPLAY_NAME);
  });

  // Renderer crash recovery: log the reason and reload. Deliberate teardowns
  // aren't crashes; the reload cap stops a crash-on-boot loop from spinning
  // forever.
  let crashReloads = 0;
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      `[desktop] renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
    if (details.reason === "clean-exit" || details.reason === "killed") return;
    if (crashReloads >= 3) {
      console.error("[desktop] renderer crashed repeatedly — not reloading again (View > Reload)");
      return;
    }
    crashReloads += 1;
    window.webContents.reload();
  });

  // A deployment that is down leaves an empty frame with no way back, so the
  // failure names itself and offers the one action that helps.
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, url, isMainFrame) => {
      if (!isMainFrame) return;
      // -3 is ERR_ABORTED, which a navigation the guard cancelled reports too.
      if (errorCode === -3) return;
      console.error(`[desktop] failed to load ${url}: ${errorDescription} (${errorCode})`);
      void window.webContents.executeJavaScript(
        `document.body.textContent = ${JSON.stringify(
          `Inteligir couldn't reach ${APP_ORIGIN}. Check your connection, then reload (⌘R).`,
        )}`,
      );
    },
  );

  window.once("ready-to-show", () => {
    window.show();
  });

  void window.loadURL(workspaceUrl(APP_ORIGIN));

  if (isDevelopment) {
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.key === "F12" && input.type === "keyDown") {
        window.webContents.toggleDevTools();
      }
    });
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

/** Bring the window forward, recreating it if the user closed it (the tray and
 * the global shortcut both have to work after that). */
function showMainWindow(): BrowserWindow {
  const existing = mainWindow;
  if (existing === null) {
    mainWindow = createWindow();
    return mainWindow;
  }
  if (existing.isMinimized()) existing.restore();
  existing.show();
  existing.focus();
  app.focus();
  return existing;
}

/** Open a translated deep-link path in the window. Nav and capture both want
 * the window in front — unlike the local host, this shell cannot apply a
 * capture in the background, so there is nothing to do quietly. */
function openDeepLinkPath(linkPath: string): void {
  const window = showMainWindow();
  void window.loadURL(`${APP_ORIGIN}${linkPath}`);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function onAppReady(): void {
  configureAppIdentity();
  configureApplicationMenu();
  updater = setupAutoUpdater({ isDevelopment });
  tray = createTray();

  if (!globalShortcut.register(SUMMON_SHORTCUT, () => showMainWindow())) {
    console.warn(`[desktop] ${SUMMON_SHORTCUT} is taken — the summon shortcut is unavailable`);
  }

  mainWindow = createWindow();

  markDeepLinksReady(openDeepLinkPath);
  // win/linux cold launch: the URL rides our own argv (macOS uses open-url).
  const launchUrl = extractDeepLinkFromArgv(process.argv);
  if (launchUrl !== null) handleDeepLinkUrl(launchUrl);
}

app.on("activate", () => {
  showMainWindow();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
});

// Single instance: deep links demand it — macOS routes open-url to the running
// instance, and win/linux deliver the URL on the SECOND instance's argv, which
// must be forwarded here and the duplicate quit.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    showMainWindow();
    const url = extractDeepLinkFromArgv(argv);
    if (url !== null) handleDeepLinkUrl(url);
  });

  app
    .whenReady()
    .then(onAppReady)
    .catch((error: unknown) => {
      console.error("[desktop] fatal startup error", error);
      dialog.showErrorBox(
        "Inteligir failed to start",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
}
