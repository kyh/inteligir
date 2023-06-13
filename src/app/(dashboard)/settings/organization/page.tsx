import SettingsTile from "~/app/(dashboard)/settings/components/SettingsTile";
import UpdateOrganizationForm from "./components/UpdateOrganizationForm";

export const metadata = {
  title: "Organization Details",
};

const OrganizationSettingsPage = () => {
  return (
    <SettingsTile heading={"General"} subHeading={"Manage your Organization"}>
      <UpdateOrganizationForm />
    </SettingsTile>
  );
};

export default OrganizationSettingsPage;
