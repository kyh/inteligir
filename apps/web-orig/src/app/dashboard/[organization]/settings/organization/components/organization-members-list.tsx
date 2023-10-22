"use client";

import type { User } from "@supabase/gotrue-js";
import { useMemo } from "react";
import { canUpdateUser } from "@/features/organizations/permissions";
import type UserData from "@/features/users/user-data";
import useUserId from "@/features/users/use-user-id";
import RoleBadge from "./role-badge";
import OrganizationMembersActionsContainer from "./organization-members-actions-container";
import Trans from "ui/components/trans";
import If from "ui/components/if";
import Badge from "ui/components/badge";
import type MembershipRole from "@/lib/organizations/types/membership-role";
import ProfileAvatar from "@/components/profile-avatar";

const OrganizationMembersList = ({
  members,
}: React.PropsWithChildren<{
  members: {
    role: MembershipRole;
    membershipId: number;
    auth: User;
    data: UserData;
  }[];
}>) => {
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
      <div className="dark:divide-dark-800 flex flex-col divide-y divide-gray-100">
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
              className={
                "flex flex-col py-2 lg:flex-row lg:items-center lg:space-x-2" +
                " justify-between space-y-2 lg:space-y-0"
              }
              data-cy="organization-member"
              key={key}
            >
              <div className="flex flex-auto items-center space-x-4">
                <ProfileAvatar text={displayName} />

                <div className="block truncate text-sm">{displayName}</div>

                <If condition={isCurrentUser}>
                  <Badge color="info" size="small">
                    <Trans i18nKey="organization:youBadgeLabel" />
                  </Badge>
                </If>
              </div>

              <div className="flex items-center justify-end space-x-4">
                <div>
                  <RoleBadge role={member.role} />
                </div>

                <OrganizationMembersActionsContainer
                  currentUserRole={userRole}
                  disabled={!shouldEnableActions}
                  targetMember={member}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrganizationMembersList;
