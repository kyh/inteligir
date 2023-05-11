"use client";

import { useCallback, useState } from "react";
import XMarkIcon from "@heroicons/react/24/outline/XMarkIcon";
import useRemoveMemberMutation from "~/lib/organizations/hooks/use-remove-member-mutation";
import Button from "~/components/Button";
import IconButton from "~/components/IconButton";
import If from "~/components/If";
import Modal from "~/components/Modal";

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
        <Modal
          heading={"Deleting Invite"}
          isOpen={isDeleting}
          setIsOpen={setIsDeleting}
        >
          <div className="flex flex-col space-y-6 text-sm">
            <p>
              You are deleting the invite to <b>{memberEmail}</b>
            </p>

            <p>Are you sure you want to continue?</p>

            <div className="flex justify-end space-x-2">
              <Modal.CancelButton onClick={() => setIsDeleting(false)} />

              <Button
                data-cy="confirm-delete-invite-button"
                onClick={onInviteDeleteRequested}
              >
                Delete Invite
              </Button>
            </div>
          </div>
        </Modal>
      </If>
    </>
  );
};

export default DeleteInviteButton;
