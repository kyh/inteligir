import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const tidyLibraryBrowser: Scenario = {
  description:
    "the Unsorted header's Tidy, the preset chip and send: the panel opens on the thread",
  name: "tidy-library-browser",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(W): tidy-library-browser not written yet")),
};
