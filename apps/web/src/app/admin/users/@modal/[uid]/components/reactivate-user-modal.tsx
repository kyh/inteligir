"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { User } from "@supabase/gotrue-js";
import { reactivateUser } from "@/app/admin/users/@modal/[uid]/actions";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import Modal from "ui/components/Modal";
import Button from "ui/components/Button";

const ReactivateUserModal = ({
  user,
}: React.PropsWithChildren<{
  user: User;
}>) => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const csrfToken = useCsrfToken();
  const displayText = user.email ?? user.phone ?? "";

  const onDismiss = () => {
    router.back();

    setIsOpen(false);
  };

  const onConfirm = () => {
    startTransition(async () => {
      await reactivateUser({
        userId: user.id,
        csrfToken,
      });

      onDismiss();
    });
  };

  return (
    <Modal heading="Reactivate User" isOpen={isOpen} setIsOpen={onDismiss}>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col space-y-2 text-sm">
          <p>
            You are about to reactivate the account belonging to{" "}
            <b>{displayText}</b>.
          </p>

          <p>Are you sure you want to do this?</p>
        </div>

        <div className="flex justify-end space-x-2.5">
          <Modal.CancelButton disabled={pending} onClick={onDismiss}>
            Cancel
          </Modal.CancelButton>

          <Button loading={pending} onClick={onConfirm}>
            Yes, reactivate user
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ReactivateUserModal;
