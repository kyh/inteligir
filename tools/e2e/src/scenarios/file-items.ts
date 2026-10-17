import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const fileItems: Scenario = {
  description:
    "a PDF, a webm and a zip saved as items, each a wrapper and its original in one commit; a file over the cap refused; a delete takes the original and Deleted lists it held by its wrapper; a restore is byte-identical; a second note embedding it keeps it",
  name: "file-items",
  run: () => Promise.reject(new ScenarioSkipError("PIVOT-STUB(S2): file-items not written yet")),
};
