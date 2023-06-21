import { useCallback } from "react";
import useTransferOrganizationOwnership from "~/lib/organizations/hooks/use-transfer-organization-ownership";
import { Button } from "~/components/Button";
import If from "~/components/If";
import Modal from "~/components/Modal";

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
    <Modal heading={"Transfer Ownership"} isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className="flex flex-col space-y-6 text-sm">
        <p>
          You are transferring ownership of the selected organization to{" "}
          <b>{targetDisplayName}</b>. Your new role will be <b>Admin</b>.
        </p>

        <p>Are you sure you want to continue?</p>

        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />

          <Button
            data-cy="confirm-transfer-ownership-button"
            onClick={onConfirmTransferOwnership}
            loading={isMutating}
          >
            <If condition={isMutating} fallback={"Transfer Ownership"}>
              Transferring ownership...
            </If>
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default TransferOrganizationOwnershipModal;
