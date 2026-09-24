// what the knowledge runtime asks of the scan, over whichever thread runs it. the server runs
// it on a worker; a suite can hand the runtime an inline transport over the same jobs.

import { Worker } from "node:worker_threads";
import { z } from "zod";
import { resolveWorkerEntry } from "../worker-entry";
import { projectionAnswerSchema } from "./projection-protocol";
import type {
  DocSource,
  ProjectedDoc,
  ProjectionJob,
  ProjectionResult,
  RenameEditsJob,
  TagRenameEditsJob,
} from "./projection-protocol";

export interface ProjectionTransport {
  run: (job: ProjectionJob) => Promise<ProjectionResult>;
  // fails every job in flight at once, rather than after it: a large note projects for seconds
  dispose: () => Promise<void>;
}

export interface Projector {
  // aligned with `docs`, one answer per doc
  project: (docs: readonly DocSource[]) => Promise<ProjectedDoc[]>;
  renameEdits: (job: RenameEditsJob) => Promise<Map<string, string>>;
  tagRenameEdits: (job: TagRenameEditsJob) => Promise<Map<string, string>>;
  dispose: () => Promise<void>;
}

const unexpected = (result: ProjectionResult): Error =>
  new Error(
    result.kind === "failed" ? result.reason : `the projection worker answered ${result.kind}`,
  );

export const createProjector = (transport: ProjectionTransport): Projector => ({
  dispose: transport.dispose,

  async project(docs) {
    const result = await transport.run({ docs, kind: "project" });
    if (result.kind !== "projected") {
      throw unexpected(result);
    }
    if (result.docs.length !== docs.length) {
      throw new Error(
        `the projection worker answered ${result.docs.length} docs for ${docs.length}`,
      );
    }
    return result.docs;
  },

  async renameEdits(job) {
    const result = await transport.run({ ...job, kind: "rename-edits" });
    if (result.kind !== "edits") {
      throw unexpected(result);
    }
    return result.edits;
  },

  async tagRenameEdits(job) {
    const result = await transport.run({ ...job, kind: "tag-rename-edits" });
    if (result.kind !== "edits") {
      throw unexpected(result);
    }
    return result.edits;
  },
});

interface Waiter {
  resolve: (result: ProjectionResult) => void;
  reject: (error: Error) => void;
}

// spawned on the first job and kept warm, since a large note is re-projected on every autosave.
// a worker that dies fails what it held and the next job spawns a fresh one; an idle worker is
// unref'd, so it never holds a process open.
const workerTransport = (): ProjectionTransport => {
  let worker: Worker | null = null;
  let nextId = 0;
  let disposed = false;
  const waiting = new Map<number, Waiter>();

  const failAll = (error: Error): void => {
    const waiters = [...waiting.values()];
    waiting.clear();
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  };

  // a dead worker reports twice ('error', then 'exit'); by the second, `waiting` holds only jobs
  // posted to its replacement, which that failAll would reject with the dead worker's error.
  const retire = (spawned: Worker, error: Error): void => {
    if (worker !== spawned) {
      return;
    }
    worker = null;
    failAll(error);
    void spawned.terminate();
  };

  const spawn = (): Worker => {
    const entry = resolveWorkerEntry(import.meta.dirname, "projection-worker");
    const spawned = new Worker(entry.path, entry.options);
    spawned.on("message", (message) => {
      const parsed = projectionAnswerSchema.safeParse(message);
      if (!parsed.success) {
        // no id to answer: a worker speaking out of protocol is retired whole
        const reason = z.prettifyError(parsed.error);
        retire(spawned, new Error(`projection worker: malformed answer: ${reason}`));
        return;
      }
      const answer = parsed.data;
      const waiter = waiting.get(answer.id);
      waiting.delete(answer.id);
      if (waiting.size === 0) {
        spawned.unref();
      }
      waiter?.resolve(answer);
    });
    spawned.on("error", (error: Error) => {
      retire(spawned, error);
    });
    spawned.on("exit", (code: number) => {
      retire(spawned, new Error(`the projection worker exited with code ${code}`));
    });
    return spawned;
  };

  return {
    async dispose() {
      disposed = true;
      failAll(new Error("the projection worker was disposed"));
      const current = worker;
      worker = null;
      await current?.terminate();
    },

    async run(job) {
      if (disposed) {
        throw new Error("the projection worker was disposed");
      }
      worker ??= spawn();
      const id = nextId;
      nextId += 1;
      const answered = Promise.withResolvers<ProjectionResult>();
      waiting.set(id, { reject: answered.reject, resolve: answered.resolve });
      worker.ref();
      worker.postMessage({ ...job, id });
      return await answered.promise;
    },
  };
};

export const createProjectionWorker = (): Projector => createProjector(workerTransport());
