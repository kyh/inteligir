import { useCallback } from "react";


import Button from "~/core/ui/Button";
import Modal from "~/core/ui/Modal";

import useRemoveMember from "~/lib/organizations/hooks/use-remove-member-mutation";

const Heading = You are removing this user;

const RemoveOrganizationMemberModal: React.FCC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  membershipId: number;
}> = ({ isOpen, setIsOpen, membershipId }) => {
  const { trigger } = useRemoveMember();

  const onMemberRemoved = useCallback(() => {
    void trigger(membershipId);

    setIsOpen(false);
  }, [trigger, membershipId, setIsOpen]);

  return (
    <Modal heading={Heading} isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className="flex flex-col space-y-6">
        <p className="text-sm">
          Are you sure you want to continue?
        </p>

        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />

          <Button
            data-cy="confirm-remove-member"
            variant="flat"
            color="danger"
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
