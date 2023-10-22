import SettingsTile from "@/app/dashboard/[organization]/settings/components/settings-tile";
import UpdateOrganizationForm from "./components/update-organization-form";
import Trans from "@inteligir/ui/trans";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Organization Details",
};

const OrganizationSettingsPage = () => {
  return (
    (<SettingsTile
      heading={General}
      subHeading={Manage your Organization}
    >
      <UpdateOrganizationForm />
    </SettingsTile>)
  );
};

export default withI18n(OrganizationSettingsPage);
