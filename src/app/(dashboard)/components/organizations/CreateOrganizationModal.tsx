import { FormEventHandler, useCallback } from "react";
import toaster from "react-hot-toast";
import useUserId from "~/core/hooks/use-user-id";
import Button from "~/core/ui/Button";
import Modal from "~/core/ui/Modal";
import TextField from "~/core/ui/TextField";
import useCreateOrganization from "~/lib/organizations/hooks/use-create-organization";

const CreateOrganizationModal: React.FC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => unknown;
}> = ({ isOpen, setIsOpen }) => {
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
        success: "Organization created successfully",
        error: "Organization not created. Please try again.",
        loading: "Creating organization...",
      });

      setIsOpen(false);
    },
    [createOrganizationMutation, setIsOpen]
  );

  return (
    <Modal isOpen={isOpen} setIsOpen={setIsOpen} heading="Create Organization">
      <form onSubmit={onSubmit}>
        <div className="flex flex-col space-y-6">
          <TextField>
            <TextField.Label>
              Organization Name
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
              Create Organization
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default CreateOrganizationModal;
