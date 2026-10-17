import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const libraryBrowser: Scenario = {
  description:
    "the seeded grid draws; open, Back and Forward; folder, tag and kind scopes; a pasted link and a dropped image become cards; a card dragged to a folder moves; Space opens Quick Look; an Info tag lands on disk; an open item follows its rename",
  name: "library-browser",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(W): library-browser not written yet")),
};
