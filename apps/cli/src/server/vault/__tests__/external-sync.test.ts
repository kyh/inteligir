import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { detectExternalSync, nodeExternalSyncDeps } from "../external-sync";
import type { ExternalSyncDeps } from "../external-sync";

const ICLOUD_DESKTOP_XATTR = "com.apple.icloud.desktop";

// realpathed: the reader judges physical paths, and tmpdir sits under a symlink on macOS
const scratchHome = (): string => makeTempDir("inteligir-external-sync-", { realpath: true });

const folderIn = (home: string, ...segments: string[]): string => {
  const dir = path.join(home, ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const detect = (home: string, dir: string, deps: Partial<ExternalSyncDeps> = {}) =>
  detectExternalSync(dir, { ...nodeExternalSyncDeps(home), ...deps });

// the two shapes Obsidian writes: the enabled ids, or every id mapped to whether it is on
type CorePlugins = readonly string[] | Readonly<Record<string, boolean>>;

const corePlugins = (vault: string, plugins: CorePlugins): void => {
  mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), JSON.stringify(plugins));
};

describe("detectExternalSync", () => {
  it("a folder in iCloud Drive, created or not yet", () => {
    const home = scratchHome();
    const vault = folderIn(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "Notes");
    expect(detect(home, vault)).toEqual({ kind: "icloud-drive" });
    expect(detect(home, path.join(vault, "not", "created"))).toEqual({ kind: "icloud-drive" });
    const obsidian = folderIn(home, "Library", "Mobile Documents", "iCloud~md~obsidian", "Vault");
    expect(detect(home, obsidian)).toEqual({ kind: "icloud-drive" });
  });

  it("a File Provider folder, reached through the ~/Dropbox symlink the app leaves", () => {
    const home = scratchHome();
    const dropbox = folderIn(home, "Library", "CloudStorage", "Dropbox");
    folderIn(dropbox, "Notes");
    symlinkSync(dropbox, path.join(home, "Dropbox"));
    expect(detect(home, path.join(home, "Dropbox", "Notes"))).toEqual({ kind: "dropbox" });
  });

  it("each File Provider by the name its folder carries", () => {
    const home = scratchHome();
    const under = (name: string) => folderIn(home, "Library", "CloudStorage", name, "Notes");
    expect(detect(home, under("GoogleDrive-me@example.com"))).toEqual({ kind: "google-drive" });
    expect(detect(home, under("OneDrive-Personal"))).toEqual({ kind: "onedrive" });
    expect(detect(home, under("Dropbox-Team"))).toEqual({ kind: "dropbox" });
    expect(detect(home, under("Box-Box"))).toEqual({ kind: "cloud-storage", provider: "Box" });
    expect(detect(home, under("constructor-x"))).toEqual({
      kind: "cloud-storage",
      provider: "constructor",
    });
  });

  it("a folder inside a Dropbox root from before File Provider, but never ~/.dropbox's", () => {
    const home = scratchHome();
    const root = folderIn(home, "Dropbox");
    writeFileSync(path.join(root, ".dropbox"), "{}");
    expect(detect(home, folderIn(root, "Work", "Notes"))).toEqual({ kind: "dropbox" });
    // the app's own settings folder sits in the home, above every folder under it
    folderIn(home, ".dropbox");
    expect(detect(home, folderIn(home, "Notes"))).toBeNull();
  });

  it("Desktop & Documents, marked by the attribute on the top folder", () => {
    const home = scratchHome();
    const documents = folderIn(home, "Documents");
    const vault = folderIn(documents, "Notes");
    const marked = (target: string, name: string): string | null =>
      target === documents && name === ICLOUD_DESKTOP_XATTR ? "1" : null;
    expect(detect(home, vault, { readXattr: marked })).toEqual({
      kind: "icloud-desktop-documents",
    });
    expect(detect(home, folderIn(home, "Desktop", "Notes"), { readXattr: marked })).toBeNull();
    expect(detect(home, vault, { readXattr: () => null })).toBeNull();
  });

  it("Obsidian Sync switched on, in either shape Obsidian writes", () => {
    const home = scratchHome();
    const listed = folderIn(home, "Listed");
    corePlugins(listed, ["file-explorer", "sync"]);
    expect(detect(home, listed)).toEqual({ kind: "obsidian-sync" });
    const mapped = folderIn(home, "Mapped");
    corePlugins(mapped, { "file-explorer": true, sync: true });
    expect(detect(home, mapped)).toEqual({ kind: "obsidian-sync" });
    const off = folderIn(home, "Off");
    corePlugins(off, { "file-explorer": true, sync: false });
    expect(detect(home, off)).toBeNull();
    const garbled = folderIn(home, "Garbled");
    mkdirSync(path.join(garbled, ".obsidian"));
    writeFileSync(path.join(garbled, ".obsidian", "core-plugins.json"), "{ not json");
    expect(detect(home, garbled)).toBeNull();
  });

  it("a plain folder in the home is nobody's", () => {
    const home = scratchHome();
    expect(detect(home, folderIn(home, "Notes"))).toBeNull();
    expect(detect(home, path.join(home, "Inteligir"))).toBeNull();
  });

  it("a reader off macOS reads no attribute", () => {
    const home = scratchHome();
    expect(nodeExternalSyncDeps(home, "linux").readXattr(home, ICLOUD_DESKTOP_XATTR)).toBeNull();
  });

  it.runIf(process.platform === "darwin")(
    "reads the attribute macOS sets, through its own tool",
    () => {
      const home = scratchHome();
      const documents = folderIn(home, "Documents");
      const vault = folderIn(documents, "Notes");
      execFileSync("/usr/bin/xattr", ["-w", ICLOUD_DESKTOP_XATTR, "1", documents]);
      expect(detectExternalSync(vault, nodeExternalSyncDeps(home))).toEqual({
        kind: "icloud-desktop-documents",
      });
      expect(detectExternalSync(vault, nodeExternalSyncDeps(home, "linux"))).toBeNull();
    },
  );
});
