import { useCallback, useTransition } from "react";
import useCsrfToken from "~/core/hooks/use-csrf-token";
import { transferOrganizationOwnershipAction } from "~/lib/organizations/actions";
import useCurrentOrganization from "~/lib/organizations/hooks/use-current-organization";
import { Button } from "~/components/Button";
import { If } from "~/components/If";
import Modal from "~/components/Modal";

const TransferOrganizationOwnershipModal: React.FC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  membershipId: number;
  targetDisplayName: string;
}> = ({ isOpen, setIsOpen, targetDisplayName, membershipId }) => {
  const csrfToken = useCsrfToken();
  const organization = useCurrentOrganization();
  const organizationUid = organization?.uuid ?? "";
  const [pending, startTransition] = useTransition();

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      startTransition(async () => {
        await transferOrganizationOwnershipAction({
          membershipId,
          csrfToken,
          organizationUid,
        });

        setIsOpen(false);
      });
    },
    [csrfToken, membershipId, setIsOpen],
  );

  return (
    <Modal heading="Transfer Ownership" isOpen={isOpen} setIsOpen={setIsOpen}>
      <form className="flex flex-col space-y-6 text-sm" onSubmit={onSubmit}>
        <p>
          You are transferring ownership of the selected organization to{" "}
          <b>{targetDisplayName}</b>. Your new role will be <b>Admin</b>.
        </p>
        <p>Are you sure you want to continue?</p>
        <div className="flex justify-end space-x-2">
          <Modal.CancelButton onClick={() => setIsOpen(false)} />
          <Button
            type="submit"
            data-cy="confirm-transfer-ownership-button"
            loading={pending}
          >
            <If condition={pending} fallback="Transfer Ownership">
              Transferring ownership...
            </If>
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default TransferOrganizationOwnershipModal;
