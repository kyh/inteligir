import { FormEventHandler, useCallback } from "react";
import { useTranslation } from "react-i18next";
import toaster from "react-hot-toast";

import Modal from "~/core/ui/Modal";
import TextField from "~/core/ui/TextField";
import Button from "~/core/ui/Button";

import useCreateOrganization from "~/lib/organizations/hooks/use-create-organization";
import useUserId from "~/core/hooks/use-user-id";
import Trans from "~/core/ui/Trans";

const Heading = <Trans i18nKey="organization:createOrganizationModalHeading" />;

const CreateOrganizationModal: React.FC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => unknown;
}> = ({ isOpen, setIsOpen }) => {
  const { t } = useTranslation();
  const userId = useUserId();
  const createOrganizationMutation = useCreateOrganization(userId);

  const onSubmit: FormEventHandler = useCallback(
    async (e) => {
      e.preventDefault();

      const organization = new FormData(e.currentTarget as HTMLFormElement).get(
        "name"
      ) as string;

      const promise = createOrganizationMutation.trigger(organization);

      await toaster.promise(promise, {
        success: t<string>("organization:createOrganizationSuccess"),
        error: t<string>("organization:createOrganizationError"),
        loading: t<string>("organization:createOrganizationLoading"),
      });

      setIsOpen(false);
    },
    [createOrganizationMutation, setIsOpen, t]
  );

  return (
    <Modal isOpen={isOpen} setIsOpen={setIsOpen} heading={Heading}>
      <form onSubmit={onSubmit}>
        <div className="flex flex-col space-y-6">
          <TextField>
            <TextField.Label>
              <Trans i18nKey="organization:organizationNameLabel" />

              <TextField.Input
                data-cy="create-organization-name-input"
                name="name"
                minLength={3}
                required
                placeholder="ex. IndieCorp"
              />
            </TextField.Label>
          </TextField>

          <div className="flex justify-end space-x-2">
            <Modal.CancelButton onClick={() => setIsOpen(false)} />

            <Button
              data-cy="confirm-create-organization-button"
              variant="flat"
              loading={createOrganizationMutation.isMutating}
            >
              <Trans i18nKey="organization:createOrganizationSubmitLabel" />
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default CreateOrganizationModal;
