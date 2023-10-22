import { useCallback, useState, useTransition } from "react";
import { updateMemberAction } from "@/features/memberships/actions";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import Trans from "ui/components/trans";
import Button from "ui/components/button";
import Modal from "ui/components/modal";
import type MembershipRole from "@/lib/organizations/types/membership-role";
import MembershipRoleSelector from "@/app/dashboard/[organization]/settings/organization/components/membership-role-selector";

const Heading = <Trans i18nKey="organization:updateMemberRoleModalHeading" />;

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
    <Modal heading={Heading} isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className="flex flex-col space-y-6">
        <MembershipRoleSelector onChange={setRole} value={role} />

        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />

          <Button
            data-cy="confirm-update-member-role"
            loading={isSubmitting}
            onClick={onRoleUpdated}
            type="button"
          >
            <Trans i18nKey="organization:updateRoleSubmitLabel" />
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default UpdateMemberRoleModal;
