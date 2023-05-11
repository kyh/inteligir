"use client";

import Link from "next/link";
import { UserPlusIcon } from "@heroicons/react/24/outline";
import useUserCanInviteUsers from "~/lib/organizations/hooks/use-user-can-invite-users";
import Button from "~/components/Button";

function InviteMembersLinkButton() {
  const canInviteUsers = useUserCanInviteUsers();

  if (!canInviteUsers) {
    return null;
  }

  return (
    <Button
      as={Link}
      className="w-full lg:w-auto"
      data-cy="invite-form-link"
      type="button"
      href="/settings/organization/members/invite"
    >
      <span className="flex items-center space-x-2">
        <UserPlusIcon className="h-5" />

        <span>Invite Members</span>
      </span>
    </Button>
  );
}

export default InviteMembersLinkButton;
