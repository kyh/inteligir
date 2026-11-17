// Each run's databases on the server POSTGRES_URL names, local Supabase's or CI's: as Playwright's
// globalSetup, the schema pushed once into a template `e2e_<run>`, which each worker clones as
// `e2e_<run>_<worker>`, and every one of them dropped when the run ends. A run's names are its own,
// so two worktrees' runs on one server never meet.

import { randomUUID } from "node:crypto";
import { dropDatabases, pushSchema, withDatabase } from "@repo/db/run-databases";
import postgres from "postgres";

// how globalSetup hands the template's name to the workers it starts
const TEMPLATE_VARIABLE = "E2E_TEMPLATE_DATABASE";

const serverUrl = (): string => {
  const url = process.env.POSTGRES_URL;
  if (url === undefined || url === "") {
    throw new Error("POSTGRES_URL names no Postgres server: run `pnpm bootstrap` first.");
  }
  return url;
};

// the server's own `postgres` database, where the run's are made and dropped
const adminOf = () => postgres(withDatabase(serverUrl(), "postgres"), { max: 1 });

// a worker's own copy of the run's template; the run's end drops it
export const workerDatabase = async (workerIndex: number): Promise<string> => {
  const template = process.env[TEMPLATE_VARIABLE];
  if (template === undefined) {
    throw new Error("No template database: playwright.config.ts's globalSetup did not run.");
  }
  const name = `${template}_${String(workerIndex)}`;
  const admin = adminOf();
  try {
    await admin`create database ${admin(name)} template ${admin(template)}`;
  } finally {
    await admin.end();
  }
  return withDatabase(serverUrl(), name);
};

const globalSetup = async () => {
  const template = `e2e_${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const admin = adminOf();
  const dropRun = async () => {
    await dropDatabases(admin, template);
    await admin.end();
  };
  await admin`create database ${admin(template)}`;
  try {
    pushSchema(withDatabase(serverUrl(), template));
  } catch (error) {
    await dropRun();
    throw error;
  }
  process.env[TEMPLATE_VARIABLE] = template;
  return dropRun;
};

export default globalSetup;
