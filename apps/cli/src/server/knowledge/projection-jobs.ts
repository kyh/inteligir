// what the projection worker computes, apart from the thread it runs on: the worker entry wires
// this to its port, and a suite can run it inline.

import { projectDoc } from "@repo/notes/knowledge/projection";
import { computeRenameEdits } from "@repo/notes/knowledge/rename-links";
import { computeTagRenameEdits } from "@repo/notes/knowledge/rename-tags";
import { docSearchColumns } from "@repo/notes/knowledge/search-columns";
import { messageOf } from "../error-message";
import type {
  DocSource,
  ProjectedDoc,
  ProjectionJob,
  ProjectionResult,
} from "./projection-protocol";

const projectOne = (doc: DocSource): ProjectedDoc => {
  try {
    const projection = projectDoc(doc.path, doc.content);
    return { kind: "projected", projection, search: docSearchColumns(projection, doc.content) };
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
      return { edits: computeRenameEdits(job), kind: "edits" };
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
