"use client";

import { useCallback, useState } from "react";
import useMutation from "swr/mutation";
import type { Factor } from "@supabase/gotrue-js";
import { useTranslation } from "react-i18next";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@inteligir/ui/tooltip";
import Spinner from "@inteligir/ui/spinner";
import Alert from "@inteligir/ui/alert";
import If from "@inteligir/ui/if";
import Button from "@inteligir/ui/button";
import Modal from "@inteligir/ui/modal";
import Badge from "@inteligir/ui/badge";
import IconButton from "@inteligir/ui/icon-button";
import Trans from "@inteligir/ui/trans";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@inteligir/ui/table";
import SettingsTile from "@/app/dashboard/[organization]/settings/components/settings-tile";
import MultiFactorAuthSetupModal from "../../components/multi-factor-auth-setup-modal";
import useSupabase from "@/core/hooks/use-supabase";
import useFactorsMutationKey from "@/core/hooks/use-user-factors-mutation-key";
import useFetchAuthFactors from "@/core/hooks/use-fetch-factors";

const MAX_FACTOR_COUNT = 10;

const MultiFactorAuthenticationSettings = () => {
  const [isMfaModalOpen, setIsMfaModalOpen] = useState(false);

  return (
    (<div>
      <SettingsTile
        heading={Multi-Factor Authentication}
        subHeading={Set up a MFA method to secure your account}
      >
        <MultiFactorAuthFactorsList
          onEnrollRequested={() => {
            setIsMfaModalOpen(true);
          }}
        />
      </SettingsTile>
      <MultiFactorAuthSetupModal
        isOpen={isMfaModalOpen}
        setIsOpen={setIsMfaModalOpen}
      />
    </div>)
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
      (<div className="flex items-center space-x-4">
        <Spinner />
        <div>
          Loading factors...
        </div>
      </div>)
    );
  }

  if (error) {
    return (
      (<div>
        <Alert type="error">
          Error loading factors list
        </Alert>
      </div>)
    );
  }

  const allFactors = factors?.all ?? [];

  if (!allFactors.length) {
    return (
      (<div className="flex flex-col space-y-4">
        <Alert type="info">
          <Alert.Heading>
            Secure your account with Multi-Factor Authentication
          </Alert.Heading>
          Enable Multi-Factor Authentication to verify your identity for an extra layer of security to your account in case your password is stolen. In addition to entering your password, it requires you confirm your identity via SMS.
        </Alert>
        <SetupMfaButton onClick={onEnrollRequested} />
      </div>)
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
            setIsModalOpen={() => {
              setUnenrolling(undefined);
            }}
          />
        )}
      </If>
    </div>
  );
};

const SetupMfaButton = (
  props: React.PropsWithChildren<{
    onClick: () => void;
  }>,
) => (
  <div>
    <Button onClick={props.onClick}>
      Setup a new Factor
    </Button>
  </div>
);

const ConfirmUnenrollFactorModal = (
  props: React.PropsWithChildren<{
    factorId: string;
    setIsModalOpen: (isOpen: boolean) => void;
  }>,
) => {
  const { t } = useTranslation();
  const unEnroll = useUnenrollFactor();

  const onUnenrollRequested = useCallback(
    async (factorId: string) => {
      if (unEnroll.isMutating) return;

      const promise = unEnroll.trigger(factorId).then(() => {
        props.setIsModalOpen(false);
      });

      toast.promise(promise, {
        loading: t(`profile:unenrollingFactor`),
        success: t(`profile:unenrollFactorSuccess`),
        error: t(`profile:unenrollFactorError`),
      });
    },
    [props, t, unEnroll],
  );

  return (
    (<Modal
      heading={Unenroll Factor}
      isOpen={Boolean(props.factorId)}
      setIsOpen={props.setIsModalOpen}
    >
      <div className="flex flex-col space-y-4">
        <div className="text-sm">
          You're about to unenroll this factor. You will not be able to use it to login to your account.
        </div>

        <div className="flex flex-row justify-end space-x-2">
          <Modal.CancelButton
            disabled={unEnroll.isMutating}
            onClick={() => {
              props.setIsModalOpen(false);
            }}
          />

          <Button
            loading={unEnroll.isMutating}
            onClick={() => onUnenrollRequested(props.factorId)}
            type="button"
            variant="destructive"
          >
            Yes, unenroll factor
          </Button>
        </div>
      </div>
    </Modal>)
  );
};

const FactorsTable = ({
  setUnenrolling,
  factors,
}: React.PropsWithChildren<{
  setUnenrolling: (factorId: string) => void;
  factors: Factor[];
}>) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>
          Factor Name
        </TableHead>
        <TableHead>
          Type
        </TableHead>
        <TableHead>
          Status
        </TableHead>

        <TableHead />
      </TableRow>
    </TableHeader>

    <TableBody>
      {factors.map((factor) => (
        <TableRow key={factor.id}>
          <TableCell>
            <span className="block truncate">{factor.friendly_name}</span>
          </TableCell>

          <TableCell>
            <Badge className="inline-flex uppercase" size="small">
              {factor.factor_type}
            </Badge>
          </TableCell>

          <TableCell>
            <Badge
              className="inline-flex capitalize"
              color={factor.status === "verified" ? "success" : "normal"}
              size="small"
            >
              {factor.status}
            </Badge>
          </TableCell>

          <TableCell className="flex justify-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  onClick={() => {
                    setUnenrolling(factor.id);
                  }}
                >
                  <XMarkIcon className="h-4" />
                </IconButton>
              </TooltipTrigger>

              <TooltipContent>
                Unenroll this factor
              </TooltipContent>
            </Tooltip>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

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
