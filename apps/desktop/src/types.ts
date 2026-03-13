export const IPC_CHANNELS = {
  PICK_FOLDER: "desktop:pick-folder",
  CONFIRM: "desktop:confirm",
  OPEN_EXTERNAL: "desktop:open-external",
  MENU_ACTION: "desktop:menu-action",
  UPDATE_STATE: "desktop:update-state",
  UPDATE_CHECK: "desktop:update-check",
  UPDATE_DOWNLOAD: "desktop:update-download",
  UPDATE_INSTALL: "desktop:update-install",
} as const;

export type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  version: string | null;
  downloadPercent: number | null;
  message: string | null;
};

export type UpdateResponse = {
  accepted: boolean;
  state: UpdateState;
};

export type DesktopBridge = {
  pickFolder: () => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateResponse>;
  installUpdate: () => Promise<UpdateResponse>;
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;
};

const UPDATE_STATUSES = new Set([
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "downloaded",
  "error",
]);

/** Intentionally validates only `status` — called in a sandboxed preload
 *  where the value always originates from the main process via IPC. */
export function isUpdateState(value: unknown): value is UpdateState {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.status === "string" && UPDATE_STATUSES.has(obj.status);
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
