// `inteligir import raindrop|status|cancel`: the import is a server job over a copy of the file, so
// these verbs only hand the file over and watch the job.

import { readFile, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { LocalClient } from "@repo/contract/local";
import {
  IMPORT_FILE_MAX_BYTES,
  importJobSchema,
} from "@repo/contract/local/imports/imports-schema";
import type { ImportJob, ImportsPlanResponse } from "@repo/contract/local/imports/imports-schema";
import { defineCommand } from "citty";
import { z } from "zod";
import { CliExitError, invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

// `import cancel`'s --json document: the stopped job, or no job when none was running
export const importCancelOutputSchema = z.strictObject({ job: importJobSchema.nullable() });

const IMPORT_POLL_MS = 1000;
const MIB = 1024 * 1024;

const count = (value: number): string => value.toLocaleString("en-US");

const plural = (value: number, one: string, many: string): string =>
  `${count(value)} ${value === 1 ? one : many}`;

// the import dialog's summary, word for word (the page says the same)
const describePlan = (plan: ImportsPlanResponse): string =>
  [
    `${plural(plan.items, "link", "links")} in ${plural(plan.folderCount, "folder", "folders")},`,
    `with ${plural(plan.tags, "tag", "tags")} and ${plural(plan.highlights, "highlight", "highlights")}.`,
    ...(plan.alreadySaved > 0
      ? [
          `${count(plan.alreadySaved)} ${plan.alreadySaved === 1 ? "is" : "are"} already in your library and stay as they are.`,
        ]
      : []),
    ...(plan.items > 0 ? ["Each page's text and picture fill in over the next while."] : []),
  ].join(" ");

const describeJob = (job: ImportJob): string => {
  if (job.state === "running") {
    return `Importing from Raindrop: ${count(job.added)} of ${count(job.total)}`;
  }
  if (job.state === "cancelled") {
    return `Stopped the import from Raindrop after ${count(job.added)} of ${count(job.total)}`;
  }
  if (job.state === "failed") {
    return `The import from Raindrop stopped: ${job.message ?? "no reason was given"}`;
  }
  const already = job.alreadySaved > 0 ? ` (${count(job.alreadySaved)} already saved)` : "";
  return `Imported ${plural(job.added, "item", "items")} from Raindrop${already}`;
};

const statOrNull = async (file: string) => {
  try {
    return await stat(file);
  } catch {
    return null;
  }
};

const readExport = async (file: string): Promise<Blob> => {
  const found = await statOrNull(file);
  if (found?.isFile() !== true) {
    throw invalidUsage(`${file} is not a file on this Mac`);
  }
  if (found.size > IMPORT_FILE_MAX_BYTES) {
    throw invalidUsage(
      `${file} is over ${IMPORT_FILE_MAX_BYTES / MIB} MB, the most an import reads`,
    );
  }
  return new Blob([new Uint8Array(await readFile(file))]);
};

// the latest status of the job this run started; another job in its place is no answer to it
const latestJob = async (api: LocalClient, id: string): Promise<ImportJob> => {
  const { job } = await api.imports.status();
  if (job?.id !== id) {
    throw new CliExitError("The import's status names another job", {
      code: "UNEXPECTED_RESPONSE",
    });
  }
  return job;
};

// the progress line is stderr's, and only a person's: a --json caller's stderr holds failures alone
const followJob = async (
  api: LocalClient,
  started: ImportJob,
  json: boolean,
): Promise<ImportJob> => {
  let job = started;
  while (job.state === "running") {
    if (!json) {
      process.stderr.write(`Imported ${count(job.added)} of ${count(job.total)}\n`);
    }
    job = await latestJob(api, job.id);
    if (job.state === "running") {
      await delay(IMPORT_POLL_MS);
    }
  }
  return job;
};

export const importCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Bring a library in from another app", name: "import" },
    subCommands: {
      cancel: defineCommand({
        args: { ...jsonArg },
        meta: { description: "Stop the import that is running", name: "cancel" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const { job } = await api.imports.status();
          if (job?.state !== "running") {
            if (outputJson(args, { job: null })) {
              return;
            }
            out.info("No import is running");
            return;
          }
          const stopped = await api.imports.cancel({ id: job.id });
          if (outputJson(args, stopped)) {
            return;
          }
          writeLines(["Stopped the import"]);
        },
      }),

      raindrop: defineCommand({
        args: {
          file: {
            description: "The CSV file a Raindrop backup exports",
            required: true,
            type: "positional",
          },
          "dry-run": {
            description: "Say what the import would do, and import nothing",
            type: "boolean",
          },
          wait: {
            default: true,
            description: "Wait until the import ends (--no-wait answers once it starts)",
            type: "boolean",
          },
          ...jsonArg,
        },
        meta: {
          description: "Import a Raindrop backup's CSV: links, folders, tags and highlights",
          name: "raindrop",
        },
        run: async ({ args }) => {
          const file = await readExport(args.file);
          const api = apiFor(deps);
          const plan = await api.imports.plan({ file, source: "raindrop" });
          if (args["dry-run"] === true) {
            if (outputJson(args, plan)) {
              return;
            }
            writeLines([describePlan(plan)]);
            return;
          }
          const json = args.json === true;
          const started = await api.imports.start({ planId: plan.planId });
          // printed once the job is started, so a refused start leaves stdout empty
          if (!json) {
            writeLines([describePlan(plan)]);
          }
          // the job is the answer however it ended: a failed one says so in its state and message,
          // as a save whose page could not be read answers its item
          const job = args.wait ? await followJob(api, started.job, json) : started.job;
          if (outputJson(args, { job })) {
            return;
          }
          writeLines([describeJob(job)]);
        },
      }),

      status: defineCommand({
        args: { ...jsonArg },
        meta: { description: "The latest import, running or ended", name: "status" },
        run: async ({ args }) => {
          const body = await apiFor(deps).imports.status();
          if (outputJson(args, body)) {
            return;
          }
          if (body.job === null) {
            out.info("No import");
            return;
          }
          writeLines([describeJob(body.job)]);
        },
      }),
    },
  });
