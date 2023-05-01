"use client";

import { useCallback, useState } from "react";
import XMarkIcon from "@heroicons/react/24/outline/XMarkIcon";

import IconButton from "~/core/ui/IconButton";
import If from "~/core/ui/If";
import Modal from "~/core/ui/Modal";
import Button from "~/core/ui/Button";
import Trans from "~/core/ui/Trans";

import useRemoveMemberMutation from "~/lib/organizations/hooks/use-remove-member-mutation";

const Heading = <Trans i18nKey="organization:deleteInviteModalHeading" />;

const DeleteInviteButton: React.FCC<{
  membershipId: number;
  memberEmail: string;
}> = ({ membershipId, memberEmail }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteRequest = useRemoveMemberMutation();

  const onInviteDeleteRequested = useCallback(async () => {
    await deleteRequest.trigger(membershipId);

    setIsDeleting(false);
  }, [deleteRequest, membershipId]);

  return (
    <>
      <IconButton
        data-cy="delete-invite-button"
        label="Delete Invite"
        onClick={() => setIsDeleting(true)}
      >
        <XMarkIcon className="h-6" />
      </IconButton>

      <If condition={isDeleting}>
        <Modal heading={Heading} isOpen={isDeleting} setIsOpen={setIsDeleting}>
          <div className="flex flex-col space-y-6 text-sm">
            <p>
              <Trans
                i18nKey="organization:confirmDeletingMemberInvite"
                values={{ email: memberEmail }}
                components={{ b: <b /> }}
              />
            </p>

            <p>
              <Trans i18nKey="common:modalConfirmationQuestion" />
            </p>

            <div className="flex justify-end space-x-2">
              <Modal.CancelButton onClick={() => setIsDeleting(false)} />

              <Button
                data-cy="confirm-delete-invite-button"
                color="danger"
                variant="flat"
                onClick={onInviteDeleteRequested}
              >
                <Trans i18nKey="organization:deleteInviteSubmitLabel" />
              </Button>
            </div>
          </div>
        </Modal>
      </If>
    </>
  );
};

export default DeleteInviteButton;
