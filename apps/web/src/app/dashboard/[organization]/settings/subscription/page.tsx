import Trans from "@inteligir/ui/trans";
import SettingsTile from "@/app/dashboard/components/settings-tile";
import Plans from "@/app/dashboard/[organization]/settings/subscription/components/plans";
import PlansStatusAlertContainer from "@/app/dashboard/[organization]/settings/subscription/components/plan-status-alert-container";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Subscription",
};

const SubscriptionSettingsPage = () => {
  return (
    (<SettingsTile
      heading={Subscription}
      subHeading={Manage your Subscription and Billing}
    >
      <div className="flex flex-col space-y-4">
        <PlansStatusAlertContainer />

        <Plans />
      </div>
    </SettingsTile>)
  );
};

export default withI18n(SubscriptionSettingsPage);
