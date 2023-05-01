import UpdatePasswordFormContainer from "~/app/(app)/settings/profile/components/UpdatePasswordFormContainer";
import SettingsTile from "~/app/(app)/settings/components/SettingsTile";


export const metadata = {
  title: "Update Password",
};

const ProfilePasswordSettingsPage = () => {
  return (
    <SettingsTile
      heading={Password}
      subHeading={Update your password}
    >
      <UpdatePasswordFormContainer />
    </SettingsTile>
  );
};

export default ProfilePasswordSettingsPage;
