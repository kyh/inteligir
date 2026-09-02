class ScenarioFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioFailure";
  }
}

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
