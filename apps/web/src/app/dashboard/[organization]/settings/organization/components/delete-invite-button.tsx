"use client";

import { useCallback, useTransition } from "react";
import XMarkIcon from "@heroicons/react/24/outline/xmark-icon";

import IconButton from "@inteligir/ui/icon-button";
import Modal from "@inteligir/ui/modal";
import Button from "@inteligir/ui/button";
import Trans from "@inteligir/ui/trans";
import useCsrfToken from "@/core/hooks/use-csrf-token";
import { deleteMemberAction } from "@/lib/memberships/actions";

const Heading = Deleting Invite;

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
    (<Modal
      heading={Heading}
      Trigger={
        <IconButton data-cy={"delete-invite-button"} label={"Delete Invite"}>
          <XMarkIcon className={"h-6"} />
        </IconButton>
      }
    >
      <div className={"flex flex-col space-y-6 text-sm"}>
        <p>
          You are deleting the invite to <b>{{ email }}</b>
        </p>

        <p>
          Are you sure you want to continue?
        </p>

        <div className={"flex justify-end"}>
          <Button
            loading={isSubmitting}
            data-cy={"confirm-delete-invite-button"}
            variant={"destructive"}
            onClick={onInviteDeleteRequested}
          >
            Delete Invite
          </Button>
        </div>
      </div>
    </Modal>)
  );
};

export default DeleteInviteButton;
