import SettingsTile from "../../components/settings-tile";
import UpdateEmailFormContainer from "../components/update-email-form-container";
import Trans from "ui/components/trans";
import { withI18n } from "@/i18n/with-i18n";

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

export default withI18n(ProfileEmailSettingsPage);
