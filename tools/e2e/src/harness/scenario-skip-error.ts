// its own module: the runner matches on it, and one class per file.
export class ScenarioSkipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioSkipError";
  }
}
