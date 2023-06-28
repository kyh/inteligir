import { FormEventHandler, useCallback, useTransition } from "react";
import toaster from "react-hot-toast";
import useCsrfToken from "~/core/hooks/use-csrf-token";
import useUserId from "~/core/hooks/use-user-id";
import { createNewOrganizationAction } from "~/lib/organizations/actions";
import { Button } from "~/components/Button";
import Modal from "~/components/Modal";
import { TextField } from "~/components/TextField";

const CreateOrganizationModal: React.FC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => unknown;
}> = ({ isOpen, setIsOpen }) => {
  const [isSubmitting, startTransition] = useTransition();
  const csrfToken = useCsrfToken();

  const createOrganizationMutation = useCallback(
    (organization: string) => {
      return startTransition(async () => {
        await createNewOrganizationAction({
          organization,
          csrfToken,
        });

        setIsOpen(false);
      });
    },
    [csrfToken, setIsOpen]
  );

  const onSubmit: FormEventHandler = useCallback(
    async (e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget as HTMLFormElement);
      const organization = data.get("name") as string;
      createOrganizationMutation(organization);
    },
    [createOrganizationMutation]
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
              loading={isSubmitting}
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
