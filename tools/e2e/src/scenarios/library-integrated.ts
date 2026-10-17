import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const libraryIntegrated: Scenario = {
  description:
    "a pasted LAN-fixture link is a pending card that opens on its placeholder, follows its rename and shows its article; a highlight; Info's site; Keep a copy of the page serves a sandboxed copy; a re-save with keepCopy adds the copy",
  name: "library-integrated",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(I): library-integrated not written yet")),
};
