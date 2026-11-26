import { app, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";

/**
 * The standard macOS menu, its Edit menu titled "Edit" so macOS adds Start Dictation, plus
 * View › Reload, the way back once a launch with no connection finds one. Quit is the system's.
 */
export const installMenu = (onReload: () => void) => {
  const view: MenuItemConstructorOptions[] = [
    { accelerator: "CmdOrCtrl+R", click: onReload, label: "Reload" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
    ...(app.isPackaged
      ? []
      : ([
          { type: "separator" },
          { role: "toggleDevTools" },
        ] satisfies MenuItemConstructorOptions[])),
  ];

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "fileMenu" },
      { role: "editMenu" },
      { label: "View", submenu: view },
      { role: "windowMenu" },
    ]),
  );
};
