"use client";

import { useMemo } from "react";
import type { User } from "@supabase/gotrue-js";
import useUserId from "~/core/hooks/use-user-id";
import type UserData from "~/core/session/types/user-data";
import { canUpdateUser } from "~/lib/organizations/permissions";
import type MembershipRole from "~/lib/organizations/types/membership-role";
import { Badge } from "~/components/Badge";
import If from "~/components/If";
import ProfileAvatar from "~/components/ProfileAvatar";
import OrganizationMembersActionsContainer from "./OrganizationMembersActionsContainer";
import RoleBadge from "./RoleBadge";

function OrganizationMembersList({
  members,
}: React.PropsWithChildren<{
  members: Array<{
    role: MembershipRole;
    membershipId: number;
    auth: User;
    data: UserData;
  }>;
}>) {
  const currentUserId = useUserId();

  const currentUser = useMemo(() => {
    return members.find((member) => {
      return member.auth.id === currentUserId;
    });
  }, [currentUserId, members]);

  if (!currentUser) {
    return null;
  }

  const userRole = currentUser.role;

  return (
    <div className="w-full space-y-10">
      <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-400">
        {members.map((member) => {
          const displayName = member.data.displayName
            ? member.data.displayName
            : member.auth.email;

          const memberId = member.auth.id;
          const isCurrentUser = currentUserId === memberId;

          // check if user has the permissions to update another member of
          // the organization. If it returns false, the actions' dropdown
          // should be disabled
          const shouldEnableActions = canUpdateUser(userRole, member.role);
          const key = `${memberId}:${userRole}`;

          return (
            <div
              key={key}
              data-cy="organization-member"
              className={
                "flex flex-col py-2 lg:flex-row lg:items-center lg:space-x-2" +
                " justify-between space-y-2 lg:space-y-0"
              }
            >
              <div className="flex flex-auto items-center space-x-4">
                <ProfileAvatar text={displayName} />

                <div className="block truncate text-sm">{displayName}</div>

                <If condition={isCurrentUser}>
                  <Badge>You</Badge>
                </If>
              </div>

              <div className="flex items-center justify-end space-x-4">
                <div>
                  <RoleBadge role={member.role} />
                </div>

                <OrganizationMembersActionsContainer
                  disabled={!shouldEnableActions}
                  targetMember={member}
                  currentUserRole={userRole}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default OrganizationMembersList;
