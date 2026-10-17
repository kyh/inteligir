import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const importIntegrated: Scenario = {
  description:
    "a Raindrop backup of LAN-fixture pages imports and fills, its highlights anchored in the articles, and a dead link's highlight and cover kept",
  name: "import-integrated",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(I): import-integrated not written yet")),
};
