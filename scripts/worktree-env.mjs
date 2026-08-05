#!/usr/bin/env node
// Run a command with this worktree's own app-state dir and dev ports.
//
// Every worktree otherwise shares ~/.inteligir and the same three fixed ports,
// so a second checkout cannot run the app at all — the host lock refuses, and
// the ports are already held. That is the whole reason `kill:ports` exists.
// Agents working issues in parallel hit it constantly.
//
// The derivation is the worktree's own path, so it is stable across runs of
// the same checkout and distinct between checkouts. The MAIN checkout keeps
// the plain defaults, so nothing about an ordinary `pnpm dev:desktop` changes.

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const DEFAULTS = { home: ".inteligir", debug: 9222, ws: 47890, executor: 47888 };

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** The checkout this script is running inside, and whether it is the primary
 * one. `git rev-parse --git-common-dir` points at the shared .git for a linked
 * worktree, so comparing it to --git-dir is the cheap primary test. */
function worktree() {
  try {
    const root = git("rev-parse", "--show-toplevel");
    const gitDir = path.resolve(git("rev-parse", "--absolute-git-dir"));
    const commonDir = path.resolve(root, git("rev-parse", "--git-common-dir"));
    return { root, primary: gitDir === commonDir };
  } catch {
    return { root: process.cwd(), primary: true };
  }
}

/** A port in the ephemeral-adjacent range, offset by the worktree hash. Ports
 * are DERIVED rather than allocated: two worktrees colliding needs a hash
 * collision, and a fixed number keeps the URLs printable and the debug port
 * attachable without discovery. */
function portFor(base, seed) {
  return base + 1 + (seed % 400);
}

const { root, primary } = worktree();
const env = { ...process.env };

if (!primary) {
  const digest = crypto.createHash("sha256").update(root).digest();
  const seed = digest.readUInt16BE(0);
  const tag = digest.toString("hex").slice(0, 8);
  env.INTELIGIR_HOME ??= path.join(os.homedir(), `${DEFAULTS.home}-${tag}`);
  env.INTELIGIR_DEBUG_PORT ??= String(portFor(DEFAULTS.debug, seed));
  env.INTELIGIR_WS_PORT ??= String(portFor(DEFAULTS.ws, seed));
  env.INTELIGIR_EXECUTOR_PORT ??= String(portFor(DEFAULTS.executor, seed));
  console.log(
    `[worktree] ${path.basename(root)} → ${env.INTELIGIR_HOME} ` +
      `(debug ${env.INTELIGIR_DEBUG_PORT}, ws ${env.INTELIGIR_WS_PORT}, ` +
      `executor ${env.INTELIGIR_EXECUTOR_PORT})`,
  );
}

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("usage: worktree-env.mjs <command> [args...]");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", env, shell: false });
child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
