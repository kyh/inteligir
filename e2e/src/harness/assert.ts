/** A failed assertion inside a scenario; the runner reports it with the
 *  instance output tails. Anything else thrown is reported the same way —
 *  this class only makes the message read as an assertion, not a crash. */
class ScenarioFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioFailure";
  }
}

/** A scenario that cannot run HERE (a capability the environment or the
 *  branch does not have yet). Skips never fail the run; the reason is
 *  printed loudly so a skip cannot rot silently. */
export class ScenarioSkip extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioSkip";
  }
}

export function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new ScenarioFailure(message);
  }
}

export function expectEq<T>(actual: T, expected: T, label: string): void {
  if (!Object.is(actual, expected)) {
    throw new ScenarioFailure(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function skip(reason: string): never {
  throw new ScenarioSkip(reason);
}
