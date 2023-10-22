import Trans from "@inteligir/ui/trans";
import SettingsTile from "../../components/settings-tile";
import UpdateEmailFormContainer from "../components/update-email-form-container";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Update Email",
};

const ProfileEmailSettingsPage = () => {
  return (
    (<SettingsTile
      heading={Email}
      subHeading={Update your email address}
    >
      <UpdateEmailFormContainer />
    </SettingsTile>)
  );
};

export default withI18n(ProfileEmailSettingsPage);
