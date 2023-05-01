import OrganizationSettingsTabs from "~/app/(app)/settings/organization/components/OrganizationSettingsTabs";
import SettingsContentContainer from "~/app/(app)/settings/components/SettingsContentContainer";
import initializeServerI18n from "~/i18n/i18n.server";
import getLanguageCookie from "~/i18n/get-language-cookie";

async function OrganizationSettingsLayout({
  children,
}: React.PropsWithChildren) {
  await initializeServerI18n(getLanguageCookie());

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
