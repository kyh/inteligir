import { createFileRoute } from "@tanstack/react-router";

import { RenderCrash } from "#library/render-crash";
import { seedSettings, SettingsRoute } from "#library/settings/settings-route";

export const Route = createFileRoute("/library/settings")({
  loader: seedSettings,
  preloadStaleTime: 0,
  component: SettingsRoute,
  errorComponent: RenderCrash,
  codeSplitGroupings: [["loader", "component", "errorComponent"]],
});
