import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const linkCapture: Scenario = {
  description:
    "a saved LAN-fixture page lands with its kind, url, site, description, cover and canonical text named by its title; a resave answers exists; a loopback, link-local or 404 page keeps the item with its fetch-error; --copy keeps a copy; save - saves stdin's links in order; a fill cut by a kill finishes at the next boot",
  name: "link-capture",
  run: () => Promise.reject(new ScenarioSkipError("PIVOT-STUB(S1): link-capture not written yet")),
};
