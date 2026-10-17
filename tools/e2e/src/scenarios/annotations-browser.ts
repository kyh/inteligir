import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const annotationsBrowser: Scenario = {
  description:
    "select, ⌘⇧H, the highlight's tint, a note saved, and its card in the Annotations tab",
  name: "annotations-browser",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(W): annotations-browser not written yet")),
};
