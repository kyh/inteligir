// Whether another service already syncs a folder, judged from where the folder physically sits:
// a path is what every one of these services keys on, and no service is asked. Read once per boot
// and never stored, since a folder does not move under a running server.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ExternalSync } from "@repo/api/local/vault/vault-schema";
import { pathContains, relativeUnder } from "../path-containment";

export interface ExternalSyncDeps {
  homeDir: string;
  // the native realpath, or null for a path that is not there
  realpath: (target: string) => string | null;
  exists: (target: string) => boolean;
  readFile: (target: string) => string | null;
  // the attribute's value, or null when the entry carries none
  readXattr: (target: string, name: string) => string | null;
}

const ICLOUD_DRIVE = ["Library", "Mobile Documents"];
const CLOUD_STORAGE = ["Library", "CloudStorage"];
// macOS names each File Provider folder `<Provider>-<account>`, or the provider alone
const CLOUD_STORAGE_PROVIDERS: ReadonlyMap<string, ExternalSync> = new Map<string, ExternalSync>([
  ["Dropbox", { kind: "dropbox" }],
  ["GoogleDrive", { kind: "google-drive" }],
  ["OneDrive", { kind: "onedrive" }],
]);
// the Dropbox root from before File Provider; `~/.dropbox` is the app's own settings, not a root
const LEGACY_DROPBOX_MARKER = ".dropbox";
const ICLOUD_DESKTOP_DOCUMENTS = ["Desktop", "Documents"];
const ICLOUD_DESKTOP_XATTR = "com.apple.icloud.desktop";
const OBSIDIAN_CORE_PLUGINS = [".obsidian", "core-plugins.json"];
const OBSIDIAN_SYNC_PLUGIN = "sync";

// the folder's physical spelling, reached through its nearest existing ancestor, so a vault not
// created yet is judged where it will land
const physicalPath = (dir: string, deps: ExternalSyncDeps): string => {
  const missing: string[] = [];
  let current = path.resolve(dir);
  for (;;) {
    const real = deps.realpath(current);
    if (real !== null) {
      return path.join(real, ...missing.toReversed());
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(dir);
    }
    missing.push(path.basename(current));
    current = parent;
  }
};

const cloudStorageSync = (folder: string, root: string): ExternalSync | null => {
  const inside = relativeUnder(root, folder);
  if (inside === null) {
    return null;
  }
  const [top = ""] = inside.split("/");
  const [prefix = ""] = top.split("-");
  const provider = prefix.length > 0 ? prefix : top;
  return CLOUD_STORAGE_PROVIDERS.get(provider) ?? { kind: "cloud-storage", provider };
};

const insideLegacyDropbox = (folder: string, homeDir: string, deps: ExternalSyncDeps): boolean => {
  for (let current = folder; ; current = path.dirname(current)) {
    if (current !== homeDir && deps.exists(path.join(current, LEGACY_DROPBOX_MARKER))) {
      return true;
    }
    if (path.dirname(current) === current) {
      return false;
    }
  }
};

// both shapes Obsidian has written: the enabled ids, and every id mapped to whether it is on
const corePluginsSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

const obsidianSyncOn = (folder: string, deps: ExternalSyncDeps): boolean => {
  const raw = deps.readFile(path.join(folder, ...OBSIDIAN_CORE_PLUGINS));
  if (raw === null) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const plugins = corePluginsSchema.safeParse(parsed);
  if (!plugins.success) {
    return false;
  }
  return Array.isArray(plugins.data)
    ? plugins.data.includes(OBSIDIAN_SYNC_PLUGIN)
    : plugins.data[OBSIDIAN_SYNC_PLUGIN] === true;
};

export const detectExternalSync = (dir: string, deps: ExternalSyncDeps): ExternalSync | null => {
  const homeDir = deps.realpath(deps.homeDir) ?? path.resolve(deps.homeDir);
  const folder = physicalPath(dir, deps);
  if (pathContains(path.join(homeDir, ...ICLOUD_DRIVE), folder)) {
    return { kind: "icloud-drive" };
  }
  const cloudStorage = cloudStorageSync(folder, path.join(homeDir, ...CLOUD_STORAGE));
  if (cloudStorage !== null) {
    return cloudStorage;
  }
  if (insideLegacyDropbox(folder, homeDir, deps)) {
    return { kind: "dropbox" };
  }
  // Desktop & Documents keeps the two folders where they are and marks each top folder
  const desktopDocuments = ICLOUD_DESKTOP_DOCUMENTS.map((name) => path.join(homeDir, name)).some(
    (top) => pathContains(top, folder) && deps.readXattr(top, ICLOUD_DESKTOP_XATTR) !== null,
  );
  if (desktopDocuments) {
    return { kind: "icloud-desktop-documents" };
  }
  if (obsidianSyncOn(folder, deps)) {
    return { kind: "obsidian-sync" };
  }
  return null;
};

const XATTR_TOOL = "/usr/bin/xattr";
const XATTR_TIMEOUT_MS = 2000;

// macOS's own tool, since node reads no extended attributes; it exits non-zero for one not set
const readXattrWithTool = (target: string, name: string): string | null => {
  try {
    return execFileSync(XATTR_TOOL, ["-p", name, target], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: XATTR_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
};

export const nodeExternalSyncDeps = (
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
): ExternalSyncDeps => ({
  exists: existsSync,
  homeDir,
  readFile: (target) => {
    try {
      return readFileSync(target, "utf-8");
    } catch {
      return null;
    }
  },
  readXattr: platform === "darwin" ? readXattrWithTool : () => null,
  realpath: (target) => {
    try {
      return realpathSync.native(target);
    } catch {
      return null;
    }
  },
});
