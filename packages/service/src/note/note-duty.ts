// What a note owes its account's cell, and when its one alarm must next run for it: the body's
// versions past what the cell holds. A note that owes nothing arms nothing.

// past the save's debounce (1 s, at most 5 s), so it projects only what the debounce missed
const BACKSTOP_MS = 10_000;
export const RETRY_MS = 30_000;

// `since`: when the note's version first passed what the cell holds
export type Duty =
  | { readonly kind: "clean" }
  | { readonly kind: "due"; readonly since: number }
  | { readonly kind: "retry"; readonly since: number; readonly at: number };

export type DutyEvent =
  // an update stored
  | { readonly kind: "appended"; readonly at: number }
  // `at`: when the projection the cell took was read; `stillDirty`: an update landed since
  | { readonly kind: "projected"; readonly at: number; readonly stillDirty: boolean }
  | { readonly kind: "projectFailed"; readonly at: number };

export const stepDuty = (duty: Duty, event: DutyEvent): Duty => {
  switch (event.kind) {
    case "appended": {
      return duty.kind === "clean" ? { kind: "due", since: event.at } : duty;
    }
    case "projected": {
      return event.stillDirty ? { kind: "due", since: event.at } : { kind: "clean" };
    }
    case "projectFailed": {
      return duty.kind === "clean"
        ? duty
        : { at: event.at + RETRY_MS, kind: "retry", since: duty.since };
    }
    // no default
  }
};

// when the alarm must next run for what the note owes; null when it owes nothing
export const deadline = (duty: Duty): number | null => {
  switch (duty.kind) {
    case "clean": {
      return null;
    }
    case "due": {
      return duty.since + BACKSTOP_MS;
    }
    case "retry": {
      return duty.at;
    }
    // no default
  }
};

// the note's meta columns a duty is kept in
export interface DutyColumns {
  readonly retryAt: number | null;
  readonly dirtyAt: number | null;
}

export const dutyOf = (
  meta: DutyColumns & { readonly version: number; readonly projected: number },
): Duty => {
  const { retryAt, dirtyAt } = meta;
  if (meta.version <= meta.projected || dirtyAt === null) {
    return { kind: "clean" };
  }
  return retryAt === null
    ? { kind: "due", since: dirtyAt }
    : { at: retryAt, kind: "retry", since: dirtyAt };
};

export const dutyColumns = (duty: Duty): DutyColumns => ({
  dirtyAt: duty.kind === "clean" ? null : duty.since,
  retryAt: duty.kind === "retry" ? duty.at : null,
});
