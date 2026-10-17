// what the projection worker computes, apart from the thread it runs on: the worker entry wires
// this to its port, and a suite can run it inline.

import { computeMoveEdits } from "@repo/notes/knowledge/rename-links";
import { computeTagRenameEdits } from "@repo/notes/knowledge/rename-tags";
import { projectForIndex } from "@repo/notes/knowledge/search-columns";
import { messageOf } from "../error-message";
import type {
  DocSource,
  ProjectedDoc,
  ProjectionJob,
  ProjectionResult,
} from "./projection-protocol";

const projectOne = (doc: DocSource): ProjectedDoc => {
  try {
    const { projection, search } = projectForIndex(doc.path, doc.content);
    return { kind: "projected", projection, search };
  } catch (error) {
    return { kind: "unprojectable", reason: messageOf(error) };
  }
};

const runJob = (job: ProjectionJob): ProjectionResult => {
  switch (job.kind) {
    case "project": {
      return { docs: job.docs.map(projectOne), kind: "projected" };
    }
    case "rename-edits": {
      return { edits: computeMoveEdits(job), kind: "edits" };
    }
    case "tag-rename-edits": {
      return { edits: computeTagRenameEdits(job.docs, job.from, job.to), kind: "edits" };
    }
    // no default
  }
};

export const runProjectionJob = (job: ProjectionJob): ProjectionResult => {
  try {
    return runJob(job);
  } catch (error) {
    return { kind: "failed", reason: messageOf(error) };
  }
};
