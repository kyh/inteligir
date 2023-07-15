import SettingsTile from "~/app/dashboard/[organization]/settings/components/SettingsTile";
import UpdateEmailFormContainer from "~/app/dashboard/[organization]/settings/profile/components/UpdateEmailFormContainer";

export const metadata = {
  title: "Update Email",
};

const ProfileEmailSettingsPage = () => {
  return (
    <SettingsTile heading="Email" subHeading="Update your email address">
      <UpdateEmailFormContainer />
    </SettingsTile>
  );
};

export default ProfileEmailSettingsPage;
