// Where a conversation's work stands in the instance that holds it, as one value both drivers
// move by `nextDrive`: the object itself (`./agent-thread`), whose Lifecycle job is the durable
// record that the thread has work, and the suites' stepped host (`../test-support/thread-host`).
// Resting, the instance runs nothing; driving, it steps the loop (`./thread-loop`) until a step
// rests, and something new asked for meanwhile has it step once more rather than rest over it;
// purged, the conversation is gone and every event lands nothing, so no step, job or model call
// follows a delete. A call in flight is cut for one of three reasons, which the loop reads off its
// abort: the person's stop settles it, a silence sends it again, and a purge leaves it untouched.

// what a step left: more to do now, a retry the drive job was re-timed for, the person to wait on,
// nothing to do, or the thread purged
export type StepResult = "continue" | "later" | "paused" | "idle" | "purged";

export type Drive =
  | { readonly kind: "resting" }
  | { readonly kind: "driving"; readonly again: boolean }
  | { readonly kind: "purged" };

// something new for the thread (a send, an answer, a stop, an inspection that found open work);
// the drive job come due; a step's result; a step that threw; the conversation deleted
export type DriveEvent =
  | { readonly kind: "wake" }
  | { readonly kind: "kick" }
  | { readonly kind: "stepped"; readonly result: StepResult }
  | { readonly kind: "threw" }
  | { readonly kind: "purge" };

// what the driver does once the drive moved: push the drive job for now, start the work, cut a
// reply gone silent, take the next step, cancel the drive job, time it for a retry, cut every
// call and delete what the thread keeps, or nothing
export type DriveEffect = "push" | "start" | "watch" | "step" | "rest" | "retry" | "purge" | "none";

// the drive as an event left it, and what its driver does about that
export interface DriveStep {
  readonly drive: Drive;
  readonly effect: DriveEffect;
}

export const RESTING: Drive = { kind: "resting" };
const PURGED: Drive = { kind: "purged" };
const STEPPING: Drive = { again: false, kind: "driving" };

const steppedFrom = (drive: Extract<Drive, { kind: "driving" }>, result: StepResult): DriveStep => {
  switch (result) {
    case "continue": {
      return { drive: STEPPING, effect: "step" };
    }
    case "idle":
    case "paused": {
      return drive.again ? { drive: STEPPING, effect: "step" } : { drive: RESTING, effect: "rest" };
    }
    case "later": {
      // the step re-timed the drive job itself
      return { drive: RESTING, effect: "none" };
    }
    case "purged": {
      return { drive: PURGED, effect: "none" };
    }
    // no default
  }
};

export const nextDrive = (drive: Drive, event: DriveEvent): DriveStep => {
  if (drive.kind === "purged") {
    return { drive, effect: "none" };
  }
  switch (event.kind) {
    case "purge": {
      return { drive: PURGED, effect: "purge" };
    }
    case "wake": {
      return {
        drive: drive.kind === "driving" ? { again: true, kind: "driving" } : drive,
        effect: "push",
      };
    }
    case "kick": {
      return drive.kind === "driving"
        ? { drive, effect: "watch" }
        : { drive: STEPPING, effect: "start" };
    }
    case "stepped": {
      return drive.kind === "driving"
        ? steppedFrom(drive, event.result)
        : { drive, effect: "none" };
    }
    case "threw": {
      return drive.kind === "driving"
        ? { drive: RESTING, effect: "retry" }
        : { drive, effect: "none" };
    }
    // no default
  }
};

// why a call in flight was cut: the person stopped its turn, its reply went silent, or the
// conversation was deleted
export type Cut = "stopped" | "silent" | "purged";

const CUT_WORDS = {
  purged: "The conversation was deleted.",
  silent: "No byte of the reply arrived for three minutes.",
  stopped: "The person stopped this turn.",
} satisfies Record<Cut, string>;

class CallCutError extends Error {
  readonly cut: Cut;

  constructor(cut: Cut) {
    super(CUT_WORDS[cut]);
    this.name = "CallCutError";
    this.cut = cut;
  }
}

export const cutCall = (abort: AbortController, cut: Cut): void => {
  abort.abort(new CallCutError(cut));
};

// why the call under `signal` was cut, null while it was not
export const cutOf = (signal: AbortSignal): Cut | null => {
  const reason: unknown = signal.reason;
  return signal.aborted && reason instanceof CallCutError ? reason.cut : null;
};
