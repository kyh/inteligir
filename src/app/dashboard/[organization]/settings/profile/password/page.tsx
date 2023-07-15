import SettingsTile from "~/app/dashboard/[organization]/settings/components/SettingsTile";
import UpdatePasswordFormContainer from "~/app/dashboard/[organization]/settings/profile/components/UpdatePasswordFormContainer";

export const metadata = {
  title: "Update Password",
};

const ProfilePasswordSettingsPage = () => {
  return (
    <SettingsTile heading="Password" subHeading="Update your password">
      <UpdatePasswordFormContainer />
    </SettingsTile>
  );
};

export default ProfilePasswordSettingsPage;
