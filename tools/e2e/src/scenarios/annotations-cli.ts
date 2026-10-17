import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const annotationsCli: Scenario = {
  description:
    "annotation add puts the markers around the quote in the file; list, edit and reply; remove strips the markers",
  name: "annotations-cli",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(S3): annotations-cli not written yet")),
};
