import { randomUUID } from "node:crypto";
import { dropDatabases, pushSchema, withDatabase } from "@repo/db/run-databases";
import postgres from "postgres";

const TEMPLATE_VARIABLE = "E2E_TEMPLATE_DATABASE";

const serverUrl = () => {
  const url = process.env.POSTGRES_URL;

  if (url === undefined || url === "") {
    throw new Error("POSTGRES_URL names no Postgres server: run `pnpm bootstrap` first.");
  }

  return url;
};

const adminOf = () => postgres(withDatabase(serverUrl(), "postgres"), { max: 1 });

export const workerDatabase = async (workerIndex: number) => {
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
