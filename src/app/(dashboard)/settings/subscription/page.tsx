import SettingsTile from "~/app/(dashboard)/settings/components/SettingsTile";
import PlansStatusAlertContainer from "~/app/(dashboard)/settings/subscription/components/PlanStatusAlertContainer";
import Plans from "~/app/(dashboard)/settings/subscription/components/Plans";

export const metadata = {
  title: "Subscription",
};

const SubscriptionSettingsPage = () => {
  return (
    <SettingsTile
      heading={"Subscription"}
      subHeading={"Manage your Subscription and Billing"}
    >
      <div className="flex flex-col space-y-4">
        <PlansStatusAlertContainer />
        <Plans />
      </div>
    </SettingsTile>
  );
};

export default SubscriptionSettingsPage;
