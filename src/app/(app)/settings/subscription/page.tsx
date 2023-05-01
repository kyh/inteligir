

import SettingsTile from "~/app/(app)/settings/components/SettingsTile";
import Plans from "~/app/(app)/settings/subscription/components/Plans";
import PlansStatusAlertContainer from "~/app/(app)/settings/subscription/components/PlanStatusAlertContainer";

export const metadata = {
  title: "Subscription",
};

const SubscriptionSettingsPage = () => {
  return (
    <SettingsTile
      heading={Subscription}
      subHeading={Manage your Subscription and Billing}
    >
      <div className="flex flex-col space-y-4">
        <PlansStatusAlertContainer />

        <Plans />
      </div>
    </SettingsTile>
  );
};

export default SubscriptionSettingsPage;
