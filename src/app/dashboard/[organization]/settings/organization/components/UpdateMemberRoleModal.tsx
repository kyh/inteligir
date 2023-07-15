import { useCallback, useState, useTransition } from "react";
import useCsrfToken from "~/core/hooks/use-csrf-token";
import { updateMemberAction } from "~/lib/memberships/actions";
import type MembershipRole from "~/lib/organizations/types/membership-role";
import { Button } from "~/components/Button";
import Modal from "~/components/Modal";
import MembershipRoleSelector from "~/app/dashboard/[organization]/settings/organization/components/MembershipRoleSelector";

const UpdateMemberRoleModal: React.FCC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  membershipId: number;
  memberRole: MembershipRole;
}> = ({ isOpen, setIsOpen, memberRole, membershipId }) => {
  const [role, setRole] = useState<MembershipRole>(memberRole);
  const [isSubmitting, startTransition] = useTransition();
  const csrfToken = useCsrfToken();

  const onRoleUpdated = useCallback(async () => {
    if (role !== undefined) {
      startTransition(async () => {
        await updateMemberAction({ membershipId, role, csrfToken });

        setIsOpen(false);
      });
    }
  }, [csrfToken, membershipId, role, setIsOpen]);

  return (
    <Modal heading="Update Member's Role" isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className="flex flex-col space-y-6">
        <MembershipRoleSelector value={role} onChange={setRole} />
        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />
          <Button
            data-cy="confirm-update-member-role"
            loading={isSubmitting}
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
