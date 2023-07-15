import SettingsContentContainer from "~/app/dashboard/[organization]/settings/components/SettingsContentContainer";
import OrganizationSettingsTabs from "~/app/dashboard/[organization]/settings/organization/components/OrganizationSettingsTabs";

const OrganizationSettingsLayout = ({ children }: React.PropsWithChildren) => {
  return (
    <>
      <div>
        <OrganizationSettingsTabs />
      </div>
      <SettingsContentContainer>{children}</SettingsContentContainer>
    </>
  );
};

export default OrganizationSettingsLayout;
