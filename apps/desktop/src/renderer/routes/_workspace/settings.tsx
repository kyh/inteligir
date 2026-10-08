// Settings as its own route: deep-linkable, back/forward works, and the page's queries mount only
// while it is visited (see settings-page.tsx). It draws over the workspace, which stays mounted.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SettingsPage } from "../../app/settings/settings-page";

const Settings = () => {
  const navigate = useNavigate();
  return (
    <SettingsPage
      onBack={() => {
        void navigate({ to: "/" });
      }}
    />
  );
};

export const Route = createFileRoute("/_workspace/settings")({
  component: Settings,
});
