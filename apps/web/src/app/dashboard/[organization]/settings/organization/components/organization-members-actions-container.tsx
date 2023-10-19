import { useState } from "react";
import type { User } from "@supabase/gotrue-js";
import type UserData from "@/features/users/user-data";
import TransferOrganizationOwnershipModal from "../components/transfer-organization-ownership-modal";
import OrganizationMemberActionsDropdown from "./organization-member-actions-dropdown";
import RemoveOrganizationMemberModal from "./remove-organization-member-modal";
import UpdateMemberRoleModal from "./update-member-role-modal";
import MembershipRole from "@/lib/organizations/types/membership-role";
import If from "ui/components/if";

const OrganizationMembersActionsContainer: React.FCC<{
  targetMember: {
    role: MembershipRole;
    membershipId: number;
    auth: User;
    data: UserData;
  };
  currentUserRole: MembershipRole;
  disabled: boolean;
}> = (props) => {
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [isRemovingUser, setIsRemovingUser] = useState(false);
  const [isTransferringOwnership, setIsTransferringOwnership] = useState(false);

  const isOwner = props.currentUserRole === MembershipRole.Owner;

  const targetDisplayName =
    props.targetMember.data.displayName ?? props.targetMember.auth.email ?? "";

  return (
    <>
      <OrganizationMemberActionsDropdown
        disabled={props.disabled}
        isOwner={isOwner}
        onChangeRoleSelected={() => {
          setIsUpdatingRole(true);
        }}
        onRemoveSelected={() => {
          setIsRemovingUser(true);
        }}
        onTransferOwnershipSelected={() => {
          setIsTransferringOwnership(true);
        }}
      />

      <RemoveOrganizationMemberModal
        isOpen={isRemovingUser}
        membershipId={props.targetMember.membershipId}
        setIsOpen={setIsRemovingUser}
      />

      <UpdateMemberRoleModal
        isOpen={isUpdatingRole}
        memberRole={props.targetMember.role}
        membershipId={props.targetMember.membershipId}
        setIsOpen={setIsUpdatingRole}
      />

      <If condition={isOwner}>
        <TransferOrganizationOwnershipModal
          isOpen={isTransferringOwnership}
          membershipId={props.targetMember.membershipId}
          setIsOpen={setIsTransferringOwnership}
          targetDisplayName={targetDisplayName}
        />
      </If>
    </>
  );
};

export default OrganizationMembersActionsContainer;
