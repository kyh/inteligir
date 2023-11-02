import ArrowLeftIcon from "@heroicons/react/24/outline/arrow-left-icon";

import SettingsTile from "@/app/dashboard/components/settings-tile";
import InviteMembersForm from "@/app/dashboard/[organization]/settings/organization/components/invite-members-form";
import Trans from "@inteligir/ui/trans";
import Button from "@inteligir/ui/button";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Invite Members",
};

const OrganizationMembersInvitePage = () => {
  return (<>
    <SettingsTile
      heading={Invite Members}
      subHeading={Invite members to your organization}
    >
      <InviteMembersForm />
    </SettingsTile>
    <div className={"mt-4"}>
      <GoBackToMembersButton />
    </div>
  </>);
};

export default withI18n(OrganizationMembersInvitePage);

function GoBackToMembersButton() {
  return (
    (<Button size={"small"} variant={"ghost"} href={"../members"}>
      <span className={"flex items-center space-x-1"}>
        <ArrowLeftIcon className={"h-3"} />

        <span>
          Go back to members
        </span>
      </span>
    </Button>)
  );
}
