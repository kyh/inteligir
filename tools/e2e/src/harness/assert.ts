import { ScenarioSkipError } from "./scenario-skip-error";

class ScenarioFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioFailureError";
  }
}

export const expect: (condition: boolean, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) {
    throw new ScenarioFailureError(message);
  }
};

export const expectEq = <T>(actual: T, expected: T, label: string): void => {
  if (!Object.is(actual, expected)) {
    throw new ScenarioFailureError(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

export const skip: (reason: string) => never = (reason) => {
  throw new ScenarioSkipError(reason);
};
