"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { User } from "@supabase/gotrue-js";
import { impersonateUser } from "@/app/admin/users/@modal/[uid]/actions";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import ImpersonateUserAuthSetter from "../components/impersonate-user-auth-setter";
import Modal from "ui/components/modal";
import Button from "ui/components/button";
import If from "ui/components/if";
import PageLoadingIndicator from "ui/components/page-loading-indicator";
import { Alert, AlertHeading } from "ui/components/alert";

const ImpersonateUserConfirmationModal = ({
  user,
}: React.PropsWithChildren<{
  user: User;
}>) => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const csrfToken = useCsrfToken();
  const [error, setError] = useState<boolean>();

  const [tokens, setTokens] = useState<{
    accessToken: string;
    refreshToken: string;
  }>();

  const displayText = user.email ?? user.phone ?? "";

  const onDismiss = () => {
    router.back();

    setIsOpen(false);
  };

  const onConfirm = () => {
    startTransition(async () => {
      try {
        const response = await impersonateUser({
          userId: user.id,
          csrfToken,
        });

        setTokens(response);
      } catch (e) {
        setError(true);
      }
    });
  };

  return (
    <Modal heading="Impersonate User" isOpen={isOpen} setIsOpen={onDismiss}>
      <If condition={tokens}>
        {(tokens) => {
          return (
            <>
              <ImpersonateUserAuthSetter tokens={tokens} />

              <PageLoadingIndicator>
                Setting up your session...
              </PageLoadingIndicator>
            </>
          );
        }}
      </If>

      <If condition={error}>
        <Alert type="error">
          <AlertHeading>Impersonation Error</AlertHeading>
          Sorry, something went wrong. Please check the logs.
        </Alert>
      </If>

      <If condition={!error && !tokens}>
        <div className="flex flex-col space-y-4">
          <div className="flex flex-col space-y-2 text-sm">
            <p>
              You are about to impersonate the account belonging to{" "}
              <b>{displayText}</b> with ID <b>{user.id}</b>.
            </p>

            <p>
              You will be able to log in as them, see and do everything they
              can. To return to your own account, simply log out.
            </p>

            <p>
              Like Uncle Ben said, with great power comes great responsibility.
              Use this power wisely.
            </p>
          </div>

          <div className="flex justify-end space-x-2.5">
            <Modal.CancelButton disabled={pending} onClick={onDismiss}>
              Cancel
            </Modal.CancelButton>

            <Button
              loading={pending}
              onClick={onConfirm}
              type="button"
              variant="destructive"
            >
              Yes, let&apos;s do it
            </Button>
          </div>
        </div>
      </If>
    </Modal>
  );
};

export default ImpersonateUserConfirmationModal;
