import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const extensionIntegrated: Scenario = {
  description:
    "an extension save of a fixture page with a selection takes its text from the supplied page and anchors the highlight",
  name: "extension-integrated",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(I): extension-integrated not written yet")),
};
