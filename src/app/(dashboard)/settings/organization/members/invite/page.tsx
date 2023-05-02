import ArrowLeftIcon from "@heroicons/react/24/outline/ArrowLeftIcon";

import SettingsTile from "~/app/(dashboard)/settings/components/SettingsTile";
import InviteMembersForm from "~/app/(dashboard)/settings/organization/components/InviteMembersForm";

import Button from "~/core/ui/Button";

export const metadata = {
  title: "Invite Members",
};

const OrganizationMembersInvitePage = () => {
  return (
    <>
      <SettingsTile
        heading={"Invite Members"}
        subHeading={"Invite members to your organization"}
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

        <span>Go back to members</span>
      </span>
    </Button>
  );
}
