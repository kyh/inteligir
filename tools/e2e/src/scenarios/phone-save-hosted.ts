import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const phoneSaveHosted: Scenario = {
  description:
    "an offline phone save of a LAN-fixture link is a pending card with one outbox row, lands as a stub on the hosted head once online, shows the Mac's fill with its site and cover, and a second save answers already saved",
  name: "phone-save-hosted",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(M): phone-save-hosted not written yet")),
};
