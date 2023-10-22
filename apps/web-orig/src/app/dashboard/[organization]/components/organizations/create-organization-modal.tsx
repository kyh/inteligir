import type { FormEventHandler } from "react";
import { useCallback, useTransition } from "react";
import { createNewOrganizationAction } from "@/features/organizations/actions";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import Modal from "ui/components/modal";
import TextField from "ui/components/text-field";
import Button from "ui/components/button";
import Trans from "ui/components/trans";

const Heading = <Trans i18nKey="organization:createOrganizationModalHeading" />;

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
    <Modal Trigger={Trigger} heading={Heading}>
      <form onSubmit={onSubmit}>
        <div className="flex flex-col space-y-6">
          <TextField>
            <TextField.Label>
              <Trans i18nKey="organization:organizationNameLabel" />

              <TextField.Input
                data-cy="create-organization-name-input"
                minLength={3}
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
              <Trans i18nKey="organization:createOrganizationSubmitLabel" />
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default CreateOrganizationModal;
