import SettingsTile from "~/app/(app)/settings/components/SettingsTile";
import UpdateEmailFormContainer from "~/app/(app)/settings/profile/components/UpdateEmailFormContainer";
import Trans from "~/core/ui/Trans";

export const metadata = {
  title: "Update Email",
};

const ProfileEmailSettingsPage = () => {
  return (
    <SettingsTile
      heading={<Trans i18nKey="profile:emailTab" />}
      subHeading={<Trans i18nKey="profile:emailTabTabSubheading" />}
    >
      <UpdateEmailFormContainer />
    </SettingsTile>
  );
};

export default ProfileEmailSettingsPage;
