// Settings as its own route: deep-linkable, back/forward works, and the
// page's queries mount only while it is visited (see settings-page.tsx).

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SettingsPage } from "../app/settings/settings-page";
import { WorkspaceProvider } from "../app/workspace-context";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Settings() {
  const navigate = useNavigate();
  return (
    <WorkspaceProvider>
      <SettingsPage
        onBack={() => {
          void navigate({ to: "/" });
        }}
      />
    </WorkspaceProvider>
  );
}
