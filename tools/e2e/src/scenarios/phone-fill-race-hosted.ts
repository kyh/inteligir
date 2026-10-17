import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const phoneFillRaceHosted: Scenario = {
  description:
    "two Macs filling one phone stub end byte-identical with the hosted head and no conflict copy, carrying a phone's offline tag and note",
  name: "phone-fill-race-hosted",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(M): phone-fill-race-hosted not written yet")),
};
