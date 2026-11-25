import type { UpdateState } from "../shared/bridge";

/**
 * Where the update session stands. A download reads as asked until its first bytes arrive, and a
 * retry carries the failure it retries, so a retry that fails at once shows no progress between.
 */
export type Phase =
  | { kind: "idle" | "checking" | "not-available" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; percent: number | null; retrying: string | null; version: string }
  | { kind: "downloaded" | "installing"; version: string }
  | { kind: "check-failed"; message: string }
  | { kind: "download-failed" | "install-failed"; message: string; version: string };

export type UpdateEvent =
  | { kind: "check-asked" | "download-asked" | "install-asked" }
  | { kind: "checked"; found: string | null }
  | { kind: "check-ended-badly"; message: string }
  | { kind: "progress"; percent: number }
  | { kind: "download-ended"; message: string | null }
  | { kind: "install-failed"; message: string };

type Work = "check" | "download" | "install";

/** A phase and the work it starts, if any. */
export interface Step {
  phase: Phase;
  work: Work | null;
}

const CHECKABLE = new Set<Phase["kind"]>([
  "idle",
  "not-available",
  "available",
  "check-failed",
  "download-failed",
]);

type StepOf = (phase: Phase, event: UpdateEvent) => Step | null;

const stay: (phase: Phase) => Step = (phase) => ({ phase, work: null });

const checkStep: StepOf = (phase, event) => {
  if (event.kind === "check-asked") {
    return CHECKABLE.has(phase.kind) ? { phase: { kind: "checking" }, work: "check" } : null;
  }

  if (phase.kind !== "checking") {
    return null;
  }

  if (event.kind === "checked") {
    return {
      phase:
        event.found === null
          ? { kind: "not-available" }
          : { kind: "available", version: event.found },
      work: null,
    };
  }

  return event.kind === "check-ended-badly"
    ? { phase: { kind: "check-failed", message: event.message }, work: null }
    : null;
};

const downloadStep: StepOf = (phase, event) => {
  if (event.kind === "download-asked") {
    return phase.kind === "available" || phase.kind === "download-failed"
      ? {
          phase: {
            kind: "downloading",
            percent: null,
            retrying: phase.kind === "download-failed" ? phase.message : null,
            version: phase.version,
          },
          work: "download",
        }
      : null;
  }

  if (phase.kind !== "downloading") {
    return null;
  }

  if (event.kind === "progress") {
    return { phase: { ...phase, percent: event.percent }, work: null };
  }

  if (event.kind !== "download-ended") {
    return null;
  }

  return {
    phase:
      event.message === null
        ? { kind: "downloaded", version: phase.version }
        : { kind: "download-failed", message: event.message, version: phase.version },
    work: null,
  };
};

const installStep: StepOf = (phase, event) => {
  if (event.kind === "install-asked") {
    return phase.kind === "downloaded" || phase.kind === "install-failed"
      ? { phase: { kind: "installing", version: phase.version }, work: "install" }
      : null;
  }

  return event.kind === "install-failed" && phase.kind === "installing"
    ? {
        phase: { kind: "install-failed", message: event.message, version: phase.version },
        work: null,
      }
    : null;
};

const STEPS: readonly StepOf[] = [checkStep, downloadStep, installStep];

/**
 * The one step of the session: an event moves the phase or leaves it as it stands. An ask that does
 * not fit the phase (a download before a check found one, a second restart) is a no-op, and a check
 * is refused while one runs, a download is under way or an update waits to install, a failed
 * install's included.
 */
export const apply = (phase: Phase, event: UpdateEvent) => {
  for (const step of STEPS) {
    const moved = step(phase, event);

    if (moved !== null) {
      return moved;
    }
  }

  return stay(phase);
};

/**
 * The page's view: installing reads as downloaded until the app restarts, and a download reads as
 * the step it was asked from until its first bytes arrive.
 */
export const wire = (phase: Phase) => {
  switch (phase.kind) {
    case "idle":
    case "checking":
    case "not-available": {
      return { status: phase.kind } satisfies UpdateState;
    }

    case "available": {
      return { status: "available", version: phase.version } satisfies UpdateState;
    }

    case "downloading": {
      if (phase.percent !== null) {
        return { downloadPercent: phase.percent, status: "downloading" } satisfies UpdateState;
      }

      return phase.retrying === null
        ? ({ status: "available", version: phase.version } satisfies UpdateState)
        : ({
            message: phase.retrying,
            status: "download-failed",
            version: phase.version,
          } satisfies UpdateState);
    }

    case "downloaded":
    case "installing": {
      return { status: "downloaded", version: phase.version } satisfies UpdateState;
    }

    case "check-failed": {
      return { message: phase.message, status: "check-failed" } satisfies UpdateState;
    }

    default: {
      return {
        message: phase.message,
        status: phase.kind,
        version: phase.version,
      } satisfies UpdateState;
    }
  }
};

/** A share of bytes received, floored and held to 0–100. */
export const percentOf = (share: number) =>
  Number.isFinite(share) ? Math.min(100, Math.max(0, Math.floor(share))) : 0;
