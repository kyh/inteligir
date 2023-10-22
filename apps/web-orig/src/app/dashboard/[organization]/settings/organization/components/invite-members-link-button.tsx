"use client";

import { User } from "@inteligir/icons";
import Button from "ui/components/button";
import Trans from "ui/components/trans";
import useUserCanInviteUsers from "@/lib/organizations/hooks/use-user-can-invite-users";

const InviteMembersLinkButton = (
  props: React.PropsWithChildren<{
    href: string;
  }>,
) => {
  const canInviteUsers = useUserCanInviteUsers();

  if (!canInviteUsers) {
    return null;
  }

  return (
    <Button
      className="w-full lg:w-auto"
      data-cy="invite-form-link"
      href={props.href}
      size="small"
      type="button"
    >
      <span className="flex items-center space-x-2">
        <User className="h-5" />
        <span>
          <Trans i18nKey="organization:inviteMembersButtonLabel" />
        </span>
      </span>
    </Button>
  );
};

export default InviteMembersLinkButton;
