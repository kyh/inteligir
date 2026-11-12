import { createFileRoute } from "@tanstack/react-router";

import { RenderCrash } from "#library/render-crash";
import { seedSettings, SettingsPage } from "#library/settings/settings-page";

export const Route = createFileRoute("/library/settings")({
  loader: seedSettings,
  preloadStaleTime: 0,
  component: SettingsPage,
  errorComponent: RenderCrash,
  codeSplitGroupings: [["loader", "component", "errorComponent"]],
});
