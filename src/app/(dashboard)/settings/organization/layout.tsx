import SettingsContentContainer from "~/app/(dashboard)/settings/components/SettingsContentContainer";
import OrganizationSettingsTabs from "~/app/(dashboard)/settings/organization/components/OrganizationSettingsTabs";

async function OrganizationSettingsLayout({
  children,
}: React.PropsWithChildren) {
  return (
    <>
      <div>
        <OrganizationSettingsTabs />
      </div>
      <SettingsContentContainer>{children}</SettingsContentContainer>
    </>
  );
}

export default OrganizationSettingsLayout;
