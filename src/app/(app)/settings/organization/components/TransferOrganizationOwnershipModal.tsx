import { useCallback } from "react";


import useTransferOrganizationOwnership from "~/lib/organizations/hooks/use-transfer-organization-ownership";

import Button from "~/core/ui/Button";
import Modal from "~/core/ui/Modal";
import If from "~/core/ui/If";

const ModalHeading = Transfer Ownership;

const TransferOrganizationOwnershipModal: React.FC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  membershipId: number;
  targetDisplayName: string;
}> = ({ isOpen, setIsOpen, targetDisplayName, membershipId }) => {
  const { trigger, isMutating } = useTransferOrganizationOwnership();

  const onConfirmTransferOwnership = useCallback(async () => {
    await trigger({ membershipId });

    setIsOpen(false);
  }, [trigger, membershipId, setIsOpen]);

  return (
    <Modal heading={ModalHeading} isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className="flex flex-col space-y-6 text-sm">
        <p>
          You are transferring ownership of the selected organization to <b>{{ member }}</b>. Your new role will be <b>$t(common:roles.admin.label)</b>.
        </p>

        <p>
          Are you sure you want to continue?
        </p>

        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />

          <Button
            data-cy="confirm-transfer-ownership-button"
            color="danger"
            variant="flat"
            onClick={onConfirmTransferOwnership}
            loading={isMutating}
          >
            <If
              condition={isMutating}
              fallback={Transfer Ownership}
            >
              Transferring ownership...
            </If>
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default TransferOrganizationOwnershipModal;
