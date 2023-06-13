import SettingsContentContainer from "~/app/(dashboard)/settings/components/SettingsContentContainer";
import ProfileSettingsTabs from "~/app/(dashboard)/settings/profile/components/ProfileSettingsTabs";

function ProfileSettingsLayout({ children }: React.PropsWithChildren) {
  return (
    <>
      <div>
        <ProfileSettingsTabs />
      </div>

      <SettingsContentContainer>{children}</SettingsContentContainer>
    </>
  );
}

export default ProfileSettingsLayout;
