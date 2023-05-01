import SettingsContentContainer from "~/app/(app)/settings/components/SettingsContentContainer";
import ProfileSettingsTabs from "~/app/(app)/settings/profile/components/ProfileSettingsTabs";

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
