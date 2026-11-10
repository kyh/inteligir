// Settings as its own route: deep-linkable, back and forward work, and its account rows are
// asked for as the route loads (`seedReads`), so they draw at once when the cell has answered.

import { useNavigate } from "@tanstack/react-router";

import { seedReads } from "../library-tab";
import type { TabOpening } from "../library-tab";
import { accountReads } from "./account-section";
import { SettingsPage } from "./settings-page";

export const SettingsRoute = () => {
  const navigate = useNavigate();
  return (
    <SettingsPage
      onBack={() => {
        void navigate({ search: true, to: "/library" });
      }}
    />
  );
};

export const seedSettings = async ({
  context: { opening },
}: {
  context: { opening: TabOpening };
}): Promise<void> => {
  await seedReads(opening, (seed, { orpc }) => {
    const { agent, assistants, devices } = accountReads(orpc);
    return [seed(devices), seed(assistants), seed(agent)];
  });
};
