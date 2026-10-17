// one job of the fill worker: html in, a page's facts and article (or a page copy's plan, or the
// copy itself) out, with no network in reach. Every job is pure CPU over what it was handed, and a
// page that breaks the extractor answers `failed` rather than taking the worker down.

import type { FillJobInput, FillResult } from "../fill-protocol";
import { buildCopy, planCopy } from "./copy-page";
import { extractPage } from "./extract-page";

const reasonOf = (error: Error): string => `${error.name}: ${error.message}`;

const runJob = (job: FillJobInput): FillResult => {
  switch (job.kind) {
    case "extract": {
      return { kind: "extracted", ...extractPage(job) };
    }
    case "copy-plan": {
      return { kind: "copy-plan", ...planCopy(job.html, job.url) };
    }
    case "copy-build": {
      return buildCopy(job);
    }
    default: {
      const exhaustive: never = job;
      return exhaustive;
    }
  }
};

export const runFillJob = (job: FillJobInput): FillResult => {
  try {
    return runJob(job);
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? reasonOf(error) : "the page could not be read",
    };
  }
};
