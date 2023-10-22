import { useCallback, useTransition } from "react";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import { transferOrganizationOwnershipAction } from "@/features/organizations/actions";
import Trans from "ui/components/trans";
import Button from "ui/components/button";
import Modal from "ui/components/modal";
import If from "ui/components/if";
import useCurrentOrganization from "@/lib/organizations/hooks/use-current-organization";

const ModalHeading = <Trans i18nKey="organization:transferOwnership" />;

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
          <Trans
            components={{ b: <b /> }}
            i18nKey="organization:transferOwnershipDisclaimer"
            values={{
              member: targetDisplayName,
            }}
          />
        </p>

        <p>
          <Trans i18nKey="common:modalConfirmationQuestion" />
        </p>

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
            <If
              condition={pending}
              fallback={<Trans i18nKey="organization:transferOwnership" />}
            >
              <Trans i18nKey="organization:transferringOwnership" />
            </If>
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default TransferOrganizationOwnershipModal;
