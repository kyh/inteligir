// the import service's one refusal class: a closed code union, each code's sentence spelled here
// once, and the router maps every code to its wire class through a total table
// (imports-router.ts). a service throws only this, a vault refusal, or nothing.

// why a file is not the export it was said to be: not CSV at all, no url column, or no rows
export type ImportUnreadableReason = "not-csv" | "no-url-column" | "empty";

type ImportsRefusal =
  | [code: "unreadable", subject: { reason: ImportUnreadableReason; message?: string }]
  // the plan expired or a start already used it
  | [code: "plan-gone", subject?: { message?: string }]
  | [code: "job-not-found", subject?: { message?: string }]
  // a start while another job runs
  | [code: "running", subject?: { message?: string }];

export type ImportsErrorCode = ImportsRefusal[0];

const SENTENCES = {
  "job-not-found": "No import is running",
  "plan-gone": "That import plan is gone; choose the file again.",
  running: "An import is already running.",
  unreadable: "This file isn't a Raindrop export",
} satisfies Record<ImportsErrorCode, string>;

export class ImportsError extends Error {
  readonly code: ImportsErrorCode;
  // set for "unreadable" alone
  readonly reason: ImportUnreadableReason | null;

  constructor(...refusal: ImportsRefusal) {
    const [code, subject] = refusal;
    super(subject?.message ?? SENTENCES[code]);
    this.name = "ImportsError";
    this.code = code;
    this.reason = refusal[0] === "unreadable" ? refusal[1].reason : null;
  }
}
