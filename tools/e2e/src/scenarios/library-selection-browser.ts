import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const librarySelectionBrowser: Scenario = {
  description:
    "two cards selected, ⌘K and send: the stored view context is the library surface with both paths",
  name: "library-selection-browser",
  run: () =>
    Promise.reject(
      new ScenarioSkipError("PIVOT-STUB(W): library-selection-browser not written yet"),
    ),
};
