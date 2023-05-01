import SettingsTile from "~/app/(app)/settings/components/SettingsTile";
import UpdateOrganizationForm from "./components/UpdateOrganizationForm";
import Trans from "~/core/ui/Trans";

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

export default OrganizationSettingsPage;
