import ArrowLeftIcon from "@heroicons/react/24/outline/arrow-left-icon";
import SettingsTile from "@/app/dashboard/[organization]/settings/components/settings-tile";
import InviteMembersForm from "@/app/dashboard/[organization]/settings/organization/components/invite-members-form";
import Trans from "ui/components/trans";
import Button from "ui/components/button";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Invite Members",
};

const OrganizationMembersInvitePage = () => {
  return (
    <>
      <SettingsTile
        heading={<Trans i18nKey="organization:inviteMembersPageHeading" />}
        subHeading={
          <Trans i18nKey="organization:inviteMembersPageSubheading" />
        }
      >
        <InviteMembersForm />
      </SettingsTile>

      <div className="mt-4">
        <GoBackToMembersButton />
      </div>
    </>
  );
};

export default withI18n(OrganizationMembersInvitePage);

const GoBackToMembersButton = () => {
  return (
    <Button href="../members" size="small" variant="ghost">
      <span className="flex items-center space-x-1">
        <ArrowLeftIcon className="h-3" />

        <span>
          <Trans i18nKey="organization:goBackToMembersPage" />
        </span>
      </span>
    </Button>
  );
};
