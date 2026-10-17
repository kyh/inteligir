import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const viewersDesktopIntegrated: Scenario = {
  description:
    "in the desktop shell, a PDF item's frame draws, a webm reaches its metadata, and a page copy's script stays silent",
  name: "viewers-desktop-integrated",
  run: () =>
    Promise.reject(
      new ScenarioSkipError("PIVOT-STUB(I): viewers-desktop-integrated not written yet"),
    ),
  usesDesktopShell: true,
};
