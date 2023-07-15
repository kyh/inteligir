"use client";

import { useCallback, useState } from "react";
import { Factor } from "@supabase/gotrue-js";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import useMutation from "swr/mutation";
import useFetchAuthFactors from "~/core/hooks/use-fetch-factors";
import useSupabase from "~/core/hooks/use-supabase";
import useFactorsMutationKey from "~/core/hooks/use-user-factors-mutation-key";
import { Alert } from "~/components/Alert";
import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import If from "~/components/If";
import Modal from "~/components/Modal";
import Spinner from "~/components/Spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/Tooltip";
import SettingsTile from "~/app/dashboard/[organization]/settings/components/SettingsTile";
import MultiFactorAuthSetupModal from "~/app/dashboard/[organization]/settings/profile/components/MultiFactorAuthSetupModal";

const MAX_FACTOR_COUNT = 10;

const MultiFactorAuthenticationSettings = () => {
  const [isMfaModalOpen, setIsMfaModalOpen] = useState(false);

  return (
    <div>
      <SettingsTile
        heading="Multi-Factor Authentication"
        subHeading="Set up a MFA method to secure your account"
      >
        <MultiFactorAuthFactorsList
          onEnrollRequested={() => setIsMfaModalOpen(true)}
        />
      </SettingsTile>
      <MultiFactorAuthSetupModal
        isOpen={isMfaModalOpen}
        setIsOpen={setIsMfaModalOpen}
      />
    </div>
  );
};

export default MultiFactorAuthenticationSettings;

const MultiFactorAuthFactorsList = ({
  onEnrollRequested,
}: React.PropsWithChildren<{
  onEnrollRequested: () => void;
}>) => {
  const { data: factors, isLoading, error } = useFetchAuthFactors();
  const [unEnrolling, setUnenrolling] = useState<string>();

  if (isLoading) {
    return (
      <div className="flex items-center space-x-4">
        <Spinner />

        <div>Loading factors...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Alert type="error">Error loading factors list</Alert>
      </div>
    );
  }

  const allFactors = factors?.all ?? [];

  if (!allFactors.length) {
    return (
      <div className="flex flex-col space-y-4">
        <Alert
          type="info"
          heading="Secure your account with Multi-Factor Authentication"
        >
          Enable Multi-Factor Authentication to verify your identity for an
          extra layer of security to your account in case your password is
          stolen. In addition to entering your password, it requires you confirm
          your identity via SMS.
        </Alert>

        <SetupMfaButton onClick={onEnrollRequested} />
      </div>
    );
  }

  const canAddNewFactors = allFactors.length < MAX_FACTOR_COUNT;

  return (
    <div className="flex flex-col space-y-4">
      <FactorsTable factors={allFactors} setUnenrolling={setUnenrolling} />

      <If condition={canAddNewFactors}>
        <SetupMfaButton onClick={onEnrollRequested} />
      </If>

      <If condition={unEnrolling}>
        {(factorId) => (
          <ConfirmUnenrollFactorModal
            factorId={factorId}
            setIsModalOpen={() => setUnenrolling(undefined)}
          />
        )}
      </If>
    </div>
  );
};

const SetupMfaButton = (
  props: React.PropsWithChildren<{
    onClick: () => void;
  }>
) => {
  return (
    <div>
      <Button onClick={props.onClick}>Setup a new Factor</Button>
    </div>
  );
};

const ConfirmUnenrollFactorModal = (
  props: React.PropsWithChildren<{
    factorId: string;
    setIsModalOpen: (isOpen: boolean) => void;
  }>
) => {
  const unEnroll = useUnenrollFactor();

  const onUnenrollRequested = useCallback(
    async (factorId: string) => {
      if (unEnroll.isMutating) return;

      const promise = unEnroll.trigger(factorId);

      await toast.promise(promise, {
        loading: "Unenrolling...",
        success: "Unenrolled successfully",
        error: "Error unenrolling",
      });

      props.setIsModalOpen(false);
    },
    [props, unEnroll]
  );

  return (
    <Modal
      heading="Unenroll Factor"
      isOpen={!!props.factorId}
      setIsOpen={props.setIsModalOpen}
    >
      <div className="flex flex-col space-y-4">
        <div className="text-sm">
          You&apos;re about to unenroll this factor. You will not be able to use
          it to login to your account.
        </div>

        <div className="flex flex-row justify-end space-x-2">
          <Modal.CancelButton
            disabled={unEnroll.isMutating}
            onClick={() => props.setIsModalOpen(false)}
          />

          <Button
            loading={unEnroll.isMutating}
            color="danger"
            onClick={() => onUnenrollRequested(props.factorId)}
          >
            Yes, unenroll factor
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const FactorsTable = ({
  setUnenrolling,
  factors,
}: React.PropsWithChildren<{
  setUnenrolling: (factorId: string) => void;
  factors: Factor[];
}>) => {
  return (
    <table className="Table">
      <thead>
        <tr>
          <th>Factor Name</th>
          <th>Type</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>

      <tbody>
        {factors.map((factor) => (
          <tr key={factor.id}>
            <td>
              <span className="block truncate">{factor.friendly_name}</span>
            </td>

            <td>
              <Badge className="inline-flex uppercase">
                {factor.factor_type}
              </Badge>
            </td>

            <td>
              <Badge
                className="inline-flex capitalize"
                color={factor.status === "verified" ? "success" : "normal"}
              >
                {factor.status}
              </Badge>
            </td>

            <td className="flex justify-end">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => setUnenrolling(factor.id)}>
                    <XIcon className="h-4" />
                  </Button>
                </TooltipTrigger>

                <TooltipContent>Unenroll this factor</TooltipContent>
              </Tooltip>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const useUnenrollFactor = () => {
  const client = useSupabase();
  const key = useFactorsMutationKey();

  return useMutation(key, async (_, { arg: factorId }: { arg: string }) => {
    const { data, error } = await client.auth.mfa.unenroll({
      factorId,
    });

    if (error) {
      throw error;
    }

    return data;
  });
};
