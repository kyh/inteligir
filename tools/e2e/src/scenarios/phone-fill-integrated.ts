import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const phoneFillIntegrated: Scenario = {
  description:
    "a phone stub is filled by a real Mac within a minute; two real Macs racing on one stub converge; a refresh racing a phone tag keeps both; a phone delete of an image item takes its original",
  name: "phone-fill-integrated",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(I): phone-fill-integrated not written yet")),
};
