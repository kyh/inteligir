import ArrowLeftIcon from "@heroicons/react/24/outline/ArrowLeftIcon";

import SettingsTile from "~/app/(app)/settings/components/SettingsTile";
import InviteMembersForm from "~/app/(app)/settings/organization/components/InviteMembersForm";
import Trans from "~/core/ui/Trans";
import Button from "~/core/ui/Button";

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

export default OrganizationMembersInvitePage;

function GoBackToMembersButton() {
  return (
    <Button
      size="small"
      color="transparent"
      href="/settings/organization/members"
    >
      <span className="flex items-center space-x-1">
        <ArrowLeftIcon className="h-3" />

        <span>
          <Trans i18nKey="organization:goBackToMembersPage" />
        </span>
      </span>
    </Button>
  );
}
