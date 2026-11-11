// What a note owes its account's cell, and when its one alarm must next run for it: the seed it
// persisted before the cell confirmed it may drop its copy, and the body's versions past what the
// cell holds. Each duty keeps its own retry, so a call the cell answers settles only its own duty,
// and a note that owes nothing arms nothing.

// past the save's debounce (1 s, at most 5 s), so it projects only what the debounce missed
const BACKSTOP_MS = 10_000;
export const RETRY_MS = 30_000;

type SeedDuty =
  | { readonly kind: "none" }
  // persisted, its confirm asked now or on the next load
  | { readonly kind: "pending" }
  | { readonly kind: "retry"; readonly at: number };

// `since`: when the note's version first passed what the cell holds
type ProjectionDuty =
  | { readonly kind: "clean" }
  | { readonly kind: "due"; readonly since: number }
  | { readonly kind: "retry"; readonly since: number; readonly at: number };

export interface Duty {
  readonly seed: SeedDuty;
  readonly projection: ProjectionDuty;
}

export type DutyEvent =
  // an update stored
  | { readonly kind: "appended"; readonly at: number }
  // the cell's body stored as the note's first update
  | { readonly kind: "seeded"; readonly at: number }
  | { readonly kind: "seedConfirmed" }
  | { readonly kind: "seedFailed"; readonly at: number }
  // `at`: when the projection the cell took was read; `stillDirty`: an update landed since
  | { readonly kind: "projected"; readonly at: number; readonly stillDirty: boolean }
  | { readonly kind: "projectFailed"; readonly at: number };

const owedSince = (projection: ProjectionDuty, at: number): ProjectionDuty =>
  projection.kind === "clean" ? { kind: "due", since: at } : projection;

export const stepDuty = (duty: Duty, event: DutyEvent): Duty => {
  const { seed, projection } = duty;
  switch (event.kind) {
    case "appended": {
      return { projection: owedSince(projection, event.at), seed };
    }
    case "seeded": {
      return { projection: owedSince(projection, event.at), seed: { kind: "pending" } };
    }
    case "seedConfirmed": {
      return { projection, seed: { kind: "none" } };
    }
    case "seedFailed": {
      return seed.kind === "none"
        ? duty
        : { projection, seed: { at: event.at + RETRY_MS, kind: "retry" } };
    }
    case "projected": {
      return {
        projection: event.stillDirty ? { kind: "due", since: event.at } : { kind: "clean" },
        seed,
      };
    }
    case "projectFailed": {
      return projection.kind === "clean"
        ? duty
        : {
            projection: { at: event.at + RETRY_MS, kind: "retry", since: projection.since },
            seed,
          };
    }
    // no default
  }
};

const seedDeadline = (seed: SeedDuty): number | null => (seed.kind === "retry" ? seed.at : null);

const projectionDeadline = (projection: ProjectionDuty): number | null => {
  switch (projection.kind) {
    case "clean": {
      return null;
    }
    case "due": {
      return projection.since + BACKSTOP_MS;
    }
    case "retry": {
      return projection.at;
    }
    // no default
  }
};

const earliest = (times: readonly (number | null)[]): number | null => {
  const set = times.filter((at) => at !== null);
  return set.length === 0 ? null : Math.min(...set);
};

// when the alarm must next run for what the note owes; null when it owes nothing
export const deadline = (duty: Duty): number | null =>
  earliest([seedDeadline(duty.seed), projectionDeadline(duty.projection)]);

// the note's meta columns a duty is kept in: one retry column serves both duties, so it holds the
// earlier retry, and read back it is every owed duty's
export interface DutyColumns {
  readonly seedPending: number;
  readonly retryAt: number | null;
  readonly dirtyAt: number | null;
}

const seedOf = ({ seedPending, retryAt }: DutyColumns): SeedDuty => {
  if (seedPending === 0) {
    return { kind: "none" };
  }
  return retryAt === null ? { kind: "pending" } : { at: retryAt, kind: "retry" };
};

export const dutyOf = (
  meta: DutyColumns & { readonly version: number; readonly projected: number },
): Duty => {
  const { retryAt, dirtyAt } = meta;
  if (meta.version <= meta.projected || dirtyAt === null) {
    return { projection: { kind: "clean" }, seed: seedOf(meta) };
  }
  return {
    projection:
      retryAt === null
        ? { kind: "due", since: dirtyAt }
        : { at: retryAt, kind: "retry", since: dirtyAt },
    seed: seedOf(meta),
  };
};

export const dutyColumns = (duty: Duty): DutyColumns => ({
  dirtyAt: duty.projection.kind === "clean" ? null : duty.projection.since,
  retryAt: earliest([
    seedDeadline(duty.seed),
    duty.projection.kind === "retry" ? duty.projection.at : null,
  ]),
  seedPending: duty.seed.kind === "none" ? 0 : 1,
});
