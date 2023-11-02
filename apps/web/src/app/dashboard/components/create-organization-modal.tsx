import type { FormEventHandler } from "react";
import { useCallback, useTransition } from "react";
import Modal from "@inteligir/ui/modal";
import TextField from "@inteligir/ui/text-field";
import Button from "@inteligir/ui/button";
import Trans from "@inteligir/ui/trans";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import { createNewOrganizationAction } from "@/features/organizations/actions";

const Heading = Create Organization;

const CreateOrganizationModal: React.FC<{
  Trigger: React.ReactNode;
}> = ({ Trigger }) => {
  const [isSubmitting, startTransition] = useTransition();
  const csrfToken = useCsrfToken();

  const createOrganizationMutation = useCallback(
    (organization: string) => {
      startTransition(async () => {
        await createNewOrganizationAction({
          organization,
          csrfToken,
        });
      });
    },
    [csrfToken],
  );

  const onSubmit: FormEventHandler = useCallback(
    async (e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget as HTMLFormElement);
      const organization = data.get("name") as string;

      createOrganizationMutation(organization);
    },
    [createOrganizationMutation],
  );

  return (
    (<Modal Trigger={Trigger} heading={Heading}>
      <form onSubmit={onSubmit}>
        <div className="flex flex-col space-y-6">
          <TextField>
            <TextField.Label>
              Organization Name
              <TextField.Input
                data-cy="create-organization-name-input"
                name="name"
                placeholder="ex. IndieCorp"
                required
              />
            </TextField.Label>
          </TextField>

          <div className="flex justify-end space-x-2">
            <Button
              data-cy="confirm-create-organization-button"
              loading={isSubmitting}
            >
              Create Organization
            </Button>
          </div>
        </div>
      </form>
    </Modal>)
  );
};

export default CreateOrganizationModal;
