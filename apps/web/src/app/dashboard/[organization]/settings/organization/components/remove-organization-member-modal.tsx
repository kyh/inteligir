import { useCallback, useTransition } from "react";

import Trans from "@inteligir/ui/trans";
import Button from "@inteligir/ui/button";
import Modal from "@inteligir/ui/modal";

import { deleteMemberAction } from "@/lib/memberships/actions";
import useCsrfToken from "@/core/hooks/use-csrf-token";

const Heading = You are removing this user;

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
    (<Modal heading={Heading} isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className={"flex flex-col space-y-6"}>
        <p className={"text-sm"}>
          Are you sure you want to continue?
        </p>

        <div className={"flex justify-end space-x-2"}>
          <Modal.CancelButton onClick={() => setIsOpen(false)} />

          <Button
            type={"button"}
            loading={isSubmitting}
            data-cy={"confirm-remove-member"}
            variant={"destructive"}
            onClick={onMemberRemoved}
          >
            Remove User from Organization
          </Button>
        </div>
      </div>
    </Modal>)
  );
};

export default RemoveOrganizationMemberModal;
