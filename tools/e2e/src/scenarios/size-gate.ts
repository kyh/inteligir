import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const sizeGate: Scenario = {
  description:
    "a file over 10 MB never enters history, over a bare remote and over the hosted library's small push cap, and the status names it",
  name: "size-gate",
  run: () => Promise.reject(new ScenarioSkipError("PIVOT-STUB(S2): size-gate not written yet")),
};
