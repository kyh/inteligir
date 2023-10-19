import { useCallback, useTransition } from "react";
import { deleteMemberAction } from "@/features/memberships/actions";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import Trans from "ui/components/trans";
import Button from "ui/components/button";
import Modal from "ui/components/modal";

const Heading = <Trans i18nKey="organization:removeMemberModalHeading" />;

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
    <Modal heading={Heading} isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className="flex flex-col space-y-6">
        <p className="text-sm">
          <Trans i18nKey="common:modalConfirmationQuestion" />
        </p>

        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />

          <Button
            data-cy="confirm-remove-member"
            loading={isSubmitting}
            onClick={onMemberRemoved}
            type="button"
            variant="destructive"
          >
            <Trans i18nKey="organization:removeMemberSubmitLabel" />
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default RemoveOrganizationMemberModal;
