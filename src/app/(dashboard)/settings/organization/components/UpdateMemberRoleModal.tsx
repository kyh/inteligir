import { useCallback, useState } from "react";


import Button from "~/core/ui/Button";
import Modal from "~/core/ui/Modal";

import type MembershipRole from "~/lib/organizations/types/membership-role";
import useUpdateMemberRequest from "~/lib/organizations/hooks/use-update-member-role";
import MembershipRoleSelector from "~/app/(dashboard)/settings/organization/components/MembershipRoleSelector";

const Heading = Update Member's Role;

const UpdateMemberRoleModal: React.FCC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  membershipId: number;
  memberRole: MembershipRole;
}> = ({ isOpen, setIsOpen, memberRole, membershipId }) => {
  const [role, setRole] = useState<MembershipRole>(memberRole);
  const { trigger, isMutating } = useUpdateMemberRequest(membershipId);

  const onRoleUpdated = useCallback(async () => {
    if (role !== undefined) {
      await trigger({ role });

      setIsOpen(false);
    }
  }, [role, trigger, setIsOpen]);

  return (
    <Modal heading={Heading} isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className="flex flex-col space-y-6">
        <MembershipRoleSelector value={role} onChange={setRole} />

        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />

          <Button
            data-cy="confirm-update-member-role"
            variant="flat"
            loading={isMutating}
            onClick={onRoleUpdated}
          >
            Update Role
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default UpdateMemberRoleModal;
