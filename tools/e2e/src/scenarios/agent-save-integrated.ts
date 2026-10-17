import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const agentSaveIntegrated: Scenario = {
  description:
    "a scripted turn's save of a PNG lands the wrapper and the PNG in its commit, and its undo takes both back byte-exact",
  name: "agent-save-integrated",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(I): agent-save-integrated not written yet")),
};
