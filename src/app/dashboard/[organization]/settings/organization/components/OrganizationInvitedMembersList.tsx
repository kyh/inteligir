"use client";

import { canDeleteInvites } from "~/lib/organizations/permissions";
import type Membership from "~/lib/organizations/types/membership";
import ProfileAvatar from "~/components/ProfileAvatar";
import IfHasPermissions from "~/app/dashboard/components/IfHasPermissions";
import DeleteInviteButton from "./DeleteInviteButton";
import RoleBadge from "./RoleBadge";

const OrganizationInvitedMembersList: React.FCC<{
  invitedMembers: Membership[];
}> = ({ invitedMembers }) => {
  if (!invitedMembers?.length) {
    return <p className="text-sm">No pending invites found</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-400">
      {invitedMembers.map(({ invitedEmail, role, id }) => {
        return (
          <div
            key={id}
            data-cy="invited-member"
            data-id={id}
            className="flex flex-col py-2 lg:flex-row lg:items-center lg:space-x-2"
          >
            <div className="flex flex-auto items-center space-x-4">
              <ProfileAvatar text={invitedEmail} />

              <div className="block truncate text-sm">{invitedEmail}</div>
            </div>

            <div className="flex items-center justify-end space-x-4">
              <RoleBadge role={role} />

              <IfHasPermissions condition={canDeleteInvites}>
                <DeleteInviteButton
                  membershipId={id}
                  memberEmail={invitedEmail as string}
                />
              </IfHasPermissions>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default OrganizationInvitedMembersList;
