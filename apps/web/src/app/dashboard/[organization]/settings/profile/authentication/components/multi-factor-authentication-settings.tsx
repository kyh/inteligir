"use client";

import { useCallback, useState } from "react";
import useMutation from "swr/mutation";
import type { Factor } from "@supabase/gotrue-js";
import { useTranslation } from "react-i18next";
import { XMarkMini } from "@inteligir/icons";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/components/Tooltip";
import Spinner from "ui/components/Spinner";
import Alert from "ui/components/Alert";
import If from "ui/components/If";
import Button from "ui/components/Button";
import Modal from "ui/components/Modal";
import Badge from "ui/components/Badge";
import IconButton from "ui/components/IconButton";
import Trans from "ui/components/Trans";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/components/Table";
import useFactorsMutationKey from "@/features/auth/use-user-factors-mutation-key";
import useSupabase from "@/lib/supabase/use-supabase";
import useFetchAuthFactors from "@/features/auth/use-fetch-factors";
import MultiFactorAuthSetupModal from "../../components/MultiFactorAuthSetupModal";
import SettingsTile from "@/app/dashboard/[organization]/settings/components/SettingsTile";

const MAX_FACTOR_COUNT = 10;

const MultiFactorAuthenticationSettings = () => {
  const [isMfaModalOpen, setIsMfaModalOpen] = useState(false);

  return (
    <div>
      <SettingsTile
        heading={<Trans i18nKey="profile:multiFactorAuth" />}
        subHeading={<Trans i18nKey="profile:multiFactorAuthSubheading" />}
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

        <div>
          <Trans i18nKey="profile:loadingFactors" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Alert type="error">
          <Trans i18nKey="profile:factorsListError" />
        </Alert>
      </div>
    );
  }

  const allFactors = factors?.all ?? [];

  if (!allFactors.length) {
    return (
      <div className="flex flex-col space-y-4">
        <Alert type="info">
          <Alert.Heading>
            <Trans i18nKey="profile:multiFactorAuthHeading" />
          </Alert.Heading>

          <Trans i18nKey="profile:multiFactorAuthDescription" />
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
) => {
  return (
    <div>
      <Button onClick={props.onClick}>
        <Trans i18nKey="profile:setupMfaButtonLabel" />
      </Button>
    </div>
  );
};

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
    <Modal
      heading={<Trans i18nKey="profile:unenrollFactorModalHeading" />}
      isOpen={Boolean(props.factorId)}
      setIsOpen={props.setIsModalOpen}
    >
      <div className="flex flex-col space-y-4">
        <div className="text-sm">
          <Trans i18nKey="profile:unenrollFactorModalBody" />
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
            <Trans i18nKey="profile:unenrollFactorModalButtonLabel" />
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans i18nKey="profile:factorName" />
          </TableHead>
          <TableHead>
            <Trans i18nKey="profile:factorType" />
          </TableHead>
          <TableHead>
            <Trans i18nKey="profile:factorStatus" />
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
                    <XMarkMini className="h-4" />
                  </IconButton>
                </TooltipTrigger>

                <TooltipContent>
                  <Trans i18nKey="profile:unenrollTooltip" />
                </TooltipContent>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
