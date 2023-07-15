import SettingsTile from "~/app/dashboard/[organization]/settings/components/SettingsTile";
import UpdateProfileFormContainer from "~/app/dashboard/[organization]/settings/profile/components/UpdateProfileFormContainer";

export const metadata = {
  title: "Profile Settings",
};

const ProfileDetailsPage = () => {
  return (
    <SettingsTile heading="My Details" subHeading="Manage your profile details">
      <UpdateProfileFormContainer />
    </SettingsTile>
  );
};

export default ProfileDetailsPage;
