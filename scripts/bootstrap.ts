/**
 * `pnpm bootstrap`: a fresh clone to a database the app runs on, with no server running. Writes
 * .env from .env.example when there is none, starts local Postgres unless one already answers
 * where POSTGRES_URL points (another worktree's, which this one shares, naming it in .env.local
 * when no env file here does), pushes the schema and seeds the dev account. Safe to re-run: each step leaves what is already there. `--dry-run`
 * prints the steps and does none of them.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { parseEnv } from "node:util";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

const DIM = "\u001B[2m";
const CYAN = "\u001B[36m";
const GREEN = "\u001B[32m";
const RESET = "\u001B[0m";

const exec = (cmd: string) => {
  if (DRY_RUN) {
    console.log(`  [dry-run] exec: ${cmd}`);
    return;
  }
  execSync(cmd, { cwd: ROOT_DIR, stdio: "inherit" });
};

const commandExists = (cmd: string): boolean => {
  try {
    execSync(`command -v ${cmd}`, { cwd: ROOT_DIR, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const envFile = (name: string) => path.resolve(ROOT_DIR, name);

const createEnv = () => {
  if (fs.existsSync(envFile(".env"))) {
    console.log("  ✓ .env already exists, skipping");
    return;
  }
  const secret = `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`;
  const env = fs
    .readFileSync(envFile(".env.example"), "utf-8")
    .replace(/^BETTER_AUTH_SECRET=.*$/mu, secret);
  if (DRY_RUN) {
    console.log("  [dry-run] write .env from .env.example, with a fresh BETTER_AUTH_SECRET");
    return;
  }
  fs.writeFileSync(envFile(".env"), env);
  console.log("  ✓ .env created");
};

const postgresUrlIn = (name: string): string | undefined =>
  fs.existsSync(envFile(name))
    ? parseEnv(fs.readFileSync(envFile(name), "utf-8")).POSTGRES_URL
    : undefined;

// where the scripts will reach Postgres: the shell's, then .env.local's, then .env's, as `with-env`
// reads them, .env.example's standing in for an .env this run writes from it; else, for an .env
// copied from another checkout that names none, .env.example's, which no script reads
const postgresUrl = () => {
  const dotEnv = fs.existsSync(envFile(".env")) ? ".env" : ".env.example";
  const named = process.env.POSTGRES_URL ?? postgresUrlIn(".env.local") ?? postgresUrlIn(dotEnv);
  if (named !== undefined) {
    return { url: new URL(named), named: true };
  }
  const example = postgresUrlIn(".env.example");
  if (example === undefined) {
    throw new Error("No POSTGRES_URL in the shell, .env.local, .env or .env.example.");
  }
  return { url: new URL(example), named: false };
};

// where `pnpm db:start` writes it, so the build and the e2e flows reach the reused Postgres too
const namePostgresUrl = (url: URL) => {
  if (DRY_RUN) {
    console.log(`  [dry-run] write POSTGRES_URL=${url.href} into .env.local`);
    return;
  }
  const file = envFile(".env.local");
  const kept = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  const separator = kept === "" || kept.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(file, `${kept}${separator}POSTGRES_URL=${url.href}\n`);
  console.log("  ✓ .env.local names it");
};

const answers = async ({ hostname, port }: URL): Promise<boolean> => {
  const socket = connect({ host: hostname, port: Number(port === "" ? "5432" : port) });
  try {
    await once(socket, "connect", { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  } finally {
    socket.destroy();
  }
};

const startPostgres = async () => {
  console.log("\nStarting local Postgres...");
  const { url, named } = postgresUrl();
  if (await answers(url)) {
    console.log(`  ✓ Postgres already answers on ${url.host}, reused`);
    if (!named) {
      namePostgresUrl(url);
    }
    return;
  }
  try {
    exec("pnpm db:start");
  } catch (error) {
    console.log(
      `\n  ${DIM}✗ Local Supabase didn't start.${RESET} Its native runtime needs macOS 14+ on ` +
        "Apple silicon or Linux (glibc 2.35+). Elsewhere, run your own Postgres (15+) and set " +
        "POSTGRES_URL in .env.local, then re-run `pnpm bootstrap`.",
    );
    throw error;
  }
  console.log("  ✓ Postgres ready");
};

const pushSchema = () => {
  console.log("\nPushing database schema...");
  exec("pnpm db:push");
  console.log("  ✓ Schema pushed");
};

const runSeed = () => {
  console.log("\nSeeding database...");
  try {
    exec("pnpm db:seed");
  } catch (error) {
    console.log(
      `\n  ${DIM}✗ Seeding failed.${RESET} If the local database has a leftover or conflicting ` +
        "schema, run `pnpm --filter @repo/db reset` to rebuild it, then re-run `pnpm bootstrap`.",
    );
    throw error;
  }
  console.log("  ✓ Seeded the dev account and DEV-INVITE");
};

const checkAgentTooling = () => {
  console.log("\nAgent tooling...");
  if (commandExists("agent-browser")) {
    console.log("  ✓ agent-browser found");
    return;
  }
  console.log(
    `  ${DIM}○ agent-browser not found${RESET} (optional: drives the web app end-to-end)`,
  );
  console.log("    Install: npm i -g agent-browser && agent-browser install");
};

const main = async () => {
  console.log("\n  Setting up inteligir\n");
  console.log("Configuring environment...");
  // .env first: `pnpm db:start` then writes POSTGRES_URL into .env.local, which wins over it
  createEnv();
  await startPostgres();
  pushSchema();
  runSeed();
  checkAgentTooling();

  console.log(`\n  ${GREEN}Setup complete!${RESET}\n`);
  console.log(`  Start:  ${CYAN}pnpm dev:web${RESET}   (→ http://localhost:5174)`);
  console.log(
    `  Verify: ${CYAN}pnpm verify${RESET}    (typecheck · lint · knip · format · test · build)`,
  );
  console.log(`  Login:  ${CYAN}dev@inteligir.local${RESET} / ${CYAN}password${RESET}  (seeded)`);
  console.log(`  Agents: read ${CYAN}AGENTS.md${RESET}\n`);
};

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
