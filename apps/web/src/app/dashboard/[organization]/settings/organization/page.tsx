import UpdateOrganizationForm from "./components/update-organization-form";
import SettingsTile from "@/app/dashboard/[organization]/settings/components/settings-tile";
import Trans from "ui/components/trans";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Organization Details",
};

const OrganizationSettingsPage = () => {
  return (
    <SettingsTile
      heading={<Trans i18nKey="organization:generalTabLabel" />}
      subHeading={<Trans i18nKey="organization:generalTabLabelSubheading" />}
    >
      <UpdateOrganizationForm />
    </SettingsTile>
  );
};

export default withI18n(OrganizationSettingsPage);
