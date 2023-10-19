"use client";

import { canDeleteInvites } from "@/features/organizations/permissions";
import RoleBadge from "./RoleBadge";
import DeleteInviteButton from "./DeleteInviteButton";
import Trans from "ui/components/Trans";
import type Membership from "@/lib/organizations/types/membership";
import ProfileAvatar from "@/components/ProfileAvatar";
import IfHasPermissions from "@/components/IfHasPermissions";

const OrganizationInvitedMembersList: React.FCC<{
  invitedMembers: Membership[];
}> = ({ invitedMembers }) => {
  if (!invitedMembers?.length) {
    return (
      <p className="text-sm">
        <Trans i18nKey="organization:noPendingInvites" />
      </p>
    );
  }

  return (
    <div className="dark:divide-dark-800 flex flex-col divide-y divide-gray-100">
      {invitedMembers.map(({ invitedEmail, role, id }) => {
        return (
          <div
            className="flex flex-col py-2 lg:flex-row lg:items-center lg:space-x-2"
            data-cy="invited-member"
            data-id={id}
            key={id}
          >
            <div className="flex flex-auto items-center space-x-4">
              <ProfileAvatar text={invitedEmail} />

              <div className="block truncate text-sm">{invitedEmail}</div>
            </div>

            <div className="flex items-center justify-end space-x-4">
              <RoleBadge role={role} />

              <IfHasPermissions condition={canDeleteInvites}>
                <DeleteInviteButton
                  memberEmail={invitedEmail as string}
                  membershipId={id}
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
