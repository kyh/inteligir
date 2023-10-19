import SettingsContentContainer from "../components/SettingsContentContainer";
import ProfileSettingsTabs from "./components/ProfileSettingsTabs";
import { withI18n } from "@/i18n/with-i18n";

const ProfileSettingsLayout = ({
  children,
  params,
}: React.PropsWithChildren<{
  params: {
    organization: string;
  };
}>) => {
  return (
    <>
      <div>
        <ProfileSettingsTabs organizationId={params.organization} />
      </div>

      <SettingsContentContainer>{children}</SettingsContentContainer>
    </>
  );
}

export default withI18n(ProfileSettingsLayout);
