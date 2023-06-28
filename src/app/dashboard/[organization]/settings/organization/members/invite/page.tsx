import Link from "next/link";
import ArrowLeftIcon from "@heroicons/react/24/outline/ArrowLeftIcon";
import { Button } from "~/components/Button";
import SettingsTile from "~/app/dashboard/[organization]/settings/components/SettingsTile";
import InviteMembersForm from "~/app/dashboard/[organization]/settings/organization/components/InviteMembersForm";

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
      as={Link}
      href="../members"
      startIcon={<ArrowLeftIcon className="h-3" />}
    >
      Go back to members
    </Button>
  );
}
