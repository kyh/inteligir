import SettingsTile from "~/app/(app)/settings/components/SettingsTile";
import UpdateProfileFormContainer from "~/app/(app)/settings/profile/components/UpdateProfileFormContainer";
import Trans from "~/core/ui/Trans";

export const metadata = {
  title: "Profile Settings",
};

const ProfileDetailsPage = () => {
  return (
    <SettingsTile
      heading={<Trans i18nKey="profile:generalTab" />}
      subHeading={<Trans i18nKey="profile:generalTabSubheading" />}
    >
      <UpdateProfileFormContainer />
    </SettingsTile>
  );
};

export default ProfileDetailsPage;
