import { useCallback, useTransition } from "react";
import Button from "@inteligir/ui/button";
import Modal from "@inteligir/ui/modal";
import useCsrfToken from "@/core/hooks/use-csrf-token";
import { transferOrganizationOwnershipAction } from "@/lib/organizations/actions";
import useCurrentOrganization from "@/lib/organizations/hooks/use-current-organization";

const ModalHeading = "Transfer Ownership";

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
          organizationUid,
          csrfToken,
        });

        setIsOpen(false);
      });
    },
    [csrfToken, membershipId, organizationUid, setIsOpen],
  );

  return (
    <Modal heading={ModalHeading} isOpen={isOpen} setIsOpen={setIsOpen}>
      <form className="flex flex-col space-y-6 text-sm" onSubmit={onSubmit}>
        <p>
          You are transferring ownership of the selected organization to{" "}
          <b>{{ member }}</b>. Your new role will be{" "}
          <b>$t(common:roles.admin.label)</b>.
        </p>

        <p>Are you sure you want to continue?</p>

        <div className="flex justify-end space-x-2">
          <Modal.CancelButton
            onClick={() => {
              setIsOpen(false);
            }}
          />

          <Button
            data-cy="confirm-transfer-ownership-button"
            loading={pending}
            type="submit"
            variant="destructive"
          >
            Transfer Ownership
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default TransferOrganizationOwnershipModal;
