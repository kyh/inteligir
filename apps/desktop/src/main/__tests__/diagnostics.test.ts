import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "inteligir/server/testing";
import { DEBUG_NAMESPACES, parseDebugNamespaces } from "inteligir/server/debug-log";
import { describe, expect, it, vi } from "vitest";
import { createDiagnostics, DIAGNOSTICS_FILE_NAME, readDiagnosticsChoice } from "../diagnostics";
import type { DiagnosticsArgs } from "../diagnostics";
import { serverProcessEnv } from "../server-instance";
import type { ServerTarget } from "../server-instance";

const TARGET: ServerTarget = {
  dataDir: "/home/me/.inteligir",
  dataDirSource: "default",
  rootDataDir: "/home/me/.inteligir",
  vaultDir: "/home/me/Inteligir",
  vaultDirSource: "default",
};

const choiceFile = (contents?: string): string => {
  const filePath = path.join(makeTempDir("inteligir-diagnostics-"), DIAGNOSTICS_FILE_NAME);
  if (contents !== undefined) {
    writeFileSync(filePath, contents);
  }
  return filePath;
};

const diagnosticsOver = (filePath: string, overrides: Partial<DiagnosticsArgs> = {}) =>
  createDiagnostics({
    canRestart: true,
    filePath,
    relaunch: () => {},
    warn: () => {},
    ...overrides,
  });

describe("the debug choice reaches the child it forks", () => {
  it("traces every namespace the server knows when on, and names none when off", () => {
    const on: Readonly<Record<string, string>> = serverProcessEnv(TARGET, {
      debug: true,
      git: null,
      isPackaged: true,
    });
    const traced = parseDebugNamespaces("INTELIGIR_DEBUG", on.INTELIGIR_DEBUG ?? "");
    expect([...traced].toSorted()).toEqual(DEBUG_NAMESPACES.toSorted());
    expect(
      serverProcessEnv(TARGET, { debug: false, git: null, isPackaged: true }),
    ).not.toHaveProperty("INTELIGIR_DEBUG");
  });

  it("reads the stored choice as the one the next fork runs with", () => {
    expect(diagnosticsOver(choiceFile('{ "debug": true }')).debug()).toBe(true);
    expect(diagnosticsOver(choiceFile()).debug()).toBe(false);
  });
});

describe("a file the user never wrote", () => {
  it("reads malformed bytes as off, and says so", () => {
    const filePath = choiceFile("{ not json");
    const warn = vi.fn<(message: string) => void>();
    expect(readDiagnosticsChoice(filePath, warn)).toEqual({ debug: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(filePath));
  });

  it("reads a choice of the wrong shape as off, and says so", () => {
    const warn = vi.fn<(message: string) => void>();
    const diagnostics = diagnosticsOver(choiceFile('{ "debug": "yes" }'), { warn });
    expect(diagnostics.debug()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads a missing file as off without a word", () => {
    const warn = vi.fn<(message: string) => void>();
    expect(readDiagnosticsChoice(choiceFile(), warn)).toEqual({ debug: false });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("changing the choice", () => {
  it("persists it and asks for a restart the running server needs", () => {
    const filePath = choiceFile('{ "debug": true }');
    const diagnostics = diagnosticsOver(filePath);
    diagnostics.recordRun({ debug: true, kind: "owned" });

    expect(diagnostics.setDebug(false)).toEqual({
      ok: true,
      state: { canRestart: true, debug: false, restartRequired: true, server: "owned" },
    });
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({ debug: false });
    expect(readDiagnosticsChoice(filePath, () => {})).toEqual({ debug: false });
  });

  it("asks for nothing once the choice is back to what the server runs with", () => {
    const diagnostics = diagnosticsOver(choiceFile());
    diagnostics.recordRun({ debug: false, kind: "owned" });
    diagnostics.setDebug(true);
    expect(diagnostics.setDebug(false)).toMatchObject({ state: { restartRequired: false } });
  });

  it("clears the restart once a new child boots with the choice", () => {
    const diagnostics = diagnosticsOver(choiceFile());
    diagnostics.recordRun({ debug: false, kind: "owned" });
    diagnostics.setDebug(true);
    diagnostics.recordRun({ debug: diagnostics.debug(), kind: "owned" });
    expect(diagnostics.state()).toMatchObject({ debug: true, restartRequired: false });
  });

  it("says why when the choice cannot be saved, and keeps the one it had", () => {
    const blocker = path.join(makeTempDir("inteligir-diagnostics-"), "a-file");
    writeFileSync(blocker, "");
    const diagnostics = diagnosticsOver(path.join(blocker, DIAGNOSTICS_FILE_NAME));
    const answer = diagnostics.setDebug(true);
    expect(answer.ok).toBe(false);
    expect(diagnostics.debug()).toBe(false);
  });
});

describe("a server the shell adopted", () => {
  it("is blocked: neither the choice nor a restart reaches it", () => {
    const filePath = choiceFile();
    const relaunch = vi.fn<() => void>();
    const diagnostics = diagnosticsOver(filePath, { relaunch });
    diagnostics.recordRun({ kind: "adopted" });

    expect(diagnostics.state()).toMatchObject({ debug: false, server: "adopted" });
    expect(diagnostics.setDebug(true)).toMatchObject({ ok: false });
    expect(readDiagnosticsChoice(filePath, () => {})).toEqual({ debug: false });
    expect(diagnostics.restart()).toMatchObject({ ok: false });
    expect(relaunch).not.toHaveBeenCalled();
  });
});

describe("a restart", () => {
  it("relaunches once, however many times it is asked", () => {
    const relaunch = vi.fn<() => void>();
    const diagnostics = diagnosticsOver(choiceFile(), { relaunch });
    expect(diagnostics.restart()).toMatchObject({ ok: true });
    expect(diagnostics.restart()).toMatchObject({ ok: true });
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("is refused in a development shell, which cannot relaunch itself", () => {
    const relaunch = vi.fn<() => void>();
    const diagnostics = diagnosticsOver(choiceFile(), { canRestart: false, relaunch });
    expect(diagnostics.state()).toMatchObject({ canRestart: false });
    expect(diagnostics.restart()).toMatchObject({ ok: false });
    expect(relaunch).not.toHaveBeenCalled();
  });
});
