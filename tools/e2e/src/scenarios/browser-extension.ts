import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const browserExtension: Scenario = {
  description:
    "the dev extension in a real Chromium reaches the app through its native host: the welcome page says connected, a page save lands with its url and title, a second says already saved, a selection save leaves its highlight, and a stopped app answers app-unavailable",
  name: "browser-extension",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(X): browser-extension not written yet")),
};
