import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const tidyLibraryScripted: Scenario = {
  description:
    "action new --preset tidy-library stores Tidy my library as the text and the scripted echo carries the preset block; a scripted save of an SVG lands in its turn's commit and its undo takes both files back",
  name: "tidy-library-scripted",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(S3): tidy-library-scripted not written yet")),
};
