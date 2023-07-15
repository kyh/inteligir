import { useCallback, useTransition } from "react";
import useCsrfToken from "~/core/hooks/use-csrf-token";
import { deleteMemberAction } from "~/lib/memberships/actions";
import { Button } from "~/components/Button";
import Modal from "~/components/Modal";

const RemoveOrganizationMemberModal: React.FCC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  membershipId: number;
}> = ({ isOpen, setIsOpen, membershipId }) => {
  const csrfToken = useCsrfToken();
  const [isSubmitting, startTransition] = useTransition();

  const onMemberRemoved = useCallback(() => {
    startTransition(async () => {
      await deleteMemberAction({ membershipId, csrfToken });

      setIsOpen(false);
    });
  }, [csrfToken, membershipId, setIsOpen]);

  return (
    <Modal
      heading="You are removing this user"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="flex flex-col space-y-6">
        <p className="text-sm">Are you sure you want to continue?</p>
        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />
          <Button
            data-cy="confirm-remove-member"
            loading={isSubmitting}
            onClick={onMemberRemoved}
          >
            Remove User from Organization
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default RemoveOrganizationMemberModal;
