"use client";

import { useCallback, useTransition } from "react";
import XMarkIcon from "@heroicons/react/24/outline/XMarkIcon";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import { deleteMemberAction } from "@/features/memberships/actions";
import IconButton from "ui/components/IconButton";
import Modal from "ui/components/Modal";
import Button from "ui/components/Button";
import Trans from "ui/components/Trans";

const Heading = <Trans i18nKey="organization:deleteInviteModalHeading" />;

const DeleteInviteButton: React.FCC<{
  membershipId: number;
  memberEmail: string;
}> = ({ membershipId, memberEmail }) => {
  const [isSubmitting, startTransition] = useTransition();
  const csrfToken = useCsrfToken();

  const onInviteDeleteRequested = useCallback(async () => {
    startTransition(async () => {
      await deleteMemberAction({ membershipId, csrfToken });
    });
  }, [csrfToken, membershipId]);

  return (
    <Modal
      Trigger={
        <IconButton data-cy="delete-invite-button" label="Delete Invite">
          <XMarkIcon className="h-6" />
        </IconButton>
      }
      heading={Heading}
    >
      <div className="flex flex-col space-y-6 text-sm">
        <p>
          <Trans
            components={{ b: <b /> }}
            i18nKey="organization:confirmDeletingMemberInvite"
            values={{ email: memberEmail }}
          />
        </p>

        <p>
          <Trans i18nKey="common:modalConfirmationQuestion" />
        </p>

        <div className="flex justify-end">
          <Button
            data-cy="confirm-delete-invite-button"
            loading={isSubmitting}
            onClick={onInviteDeleteRequested}
            variant="destructive"
          >
            <Trans i18nKey="organization:deleteInviteSubmitLabel" />
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DeleteInviteButton;
