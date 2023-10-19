"use client";

import { useTranslation } from "react-i18next";
import { Fragment, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { XMarkMini, CircleMiniSolid } from "@inteligir/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/components/Tooltip";
import If from "ui/components/If";
import TextField from "ui/components/TextField";
import Button from "ui/components/Button";
import IconButton from "ui/components/IconButton";
import Trans from "ui/components/Trans";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import { inviteMembersToOrganizationAction } from "@/features/organizations/actions";
import MembershipRoleSelector from "./MembershipRoleSelector";
import MembershipRole from "@/lib/organizations/types/membership-role";
import useUserSession from "@/features/user/use-user-session";
import useCurrentOrganization from "@/lib/organizations/hooks/use-current-organization";

type InviteModel = ReturnType<typeof memberFactory>;

const InviteMembersForm = () => {
  const { t } = useTranslation("organization");
  const user = useUserSession();
  const organization = useCurrentOrganization();

  const [isSubmitting, startTransition] = useTransition();
  const csrfToken = useCsrfToken();

  const { register, handleSubmit, setValue, control, clearErrors, watch } =
    useInviteMembersForm();

  const { fields, append, remove } = useFieldArray({
    control,
    name: "members",
    shouldUnregister: true,
  });

  const watchFieldArray = watch("members");

  const controlledFields = fields.map((field, index) => {
    return {
      ...field,
      ...watchFieldArray[index],
    };
  });

  return (
    <form
      className="flex flex-col space-y-4"
      data-cy="invite-members-form"
      onSubmit={(event) => {
        handleSubmit((data) => {
          startTransition(async () => {
            if (!organization) {
              return;
            }

            const id = toast.loading(t("organization:inviteMembersLoading"));

            try {
              await inviteMembersToOrganizationAction({
                invites: data.members,
                csrfToken,
                organizationUid: organization.uuid,
              });

              toast.success(t("organization:inviteMembersSuccess"), {
                id,
              });
            } catch (e) {
              toast.error(t("organization:inviteMembersError"), {
                id,
              });
            }
          });
        })(event);
      }}
    >
      <div className="flex flex-col space-y-2">
        {controlledFields.map((field, index) => {
          const emailInputName = `members.${index}.email` as const;
          const roleInputName = `members.${index}.role` as const;

          // register email control
          const emailControl = register(emailInputName, {
            required: true,
            validate: (value) => {
              const invalid = getFormValidator(watchFieldArray)(value, index);

              if (invalid) {
                return t(`duplicateInviteEmailError`);
              }

              const isSameAsCurrentUserEmail = user?.auth?.user.email === value;

              if (isSameAsCurrentUserEmail) {
                return t(`invitingOwnAccountError`);
              }

              return true;
            },
          });

          // register role control
          register(roleInputName, {
            value: field.role,
          });

          return (
            <Fragment key={field.id}>
              <div className="flex items-center space-x-0.5 md:space-x-2">
                <div className="w-7/12">
                  <TextField.Input
                    {...emailControl}
                    data-cy="invite-email-input"
                    placeholder="member@email.com"
                    required
                    type="email"
                  />
                </div>

                <div className="w-4/12">
                  <MembershipRoleSelector
                    onChange={(role) => {
                      setValue(roleInputName, role);
                    }}
                    value={field.role}
                  />
                </div>

                <div className="flex w-[60px] justify-end">
                  <Tooltip className="flex justify-center">
                    <TooltipTrigger asChild>
                      <IconButton
                        data-cy="remove-invite-button"
                        disabled={fields.length <= 1}
                        label={t("removeInviteButtonLabel")}
                        onClick={() => {
                          remove(index);
                          clearErrors(emailInputName);
                        }}
                        type="button"
                      >
                        <XMarkMini className="h-4 lg:h-5" />
                      </IconButton>
                    </TooltipTrigger>

                    <TooltipContent>
                      {t("removeInviteButtonLabel")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </Fragment>
          );
        })}

        <div>
          <Button
            data-cy="append-new-invite-button"
            onClick={() => {
              append(memberFactory());
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="flex items-center space-x-2">
              <CircleMiniSolid className="h-5" />

              <span>
                <Trans i18nKey="organization:addAnotherMemberButtonLabel" />
              </span>
            </span>
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          className="w-full lg:w-auto"
          data-cy="send-invites-button"
          loading={isSubmitting}
          type="submit"
        >
          <If condition={!isSubmitting}>
            <Trans i18nKey="organization:inviteMembersSubmitLabel" />
          </If>

          <If condition={isSubmitting}>
            <Trans i18nKey="organization:inviteMembersLoading" />
          </If>
        </Button>
      </div>
    </form>
  );
};

const memberFactory = () => ({
  email: "",
  role: MembershipRole.Member,
});

const useInviteMembersForm = () =>
  useForm({
    defaultValues: {
      members: [memberFactory()],
    },
    shouldUseNativeValidation: true,
    shouldFocusError: true,
    shouldUnregister: true,
  });

const getFormValidator =
  (members: InviteModel[]) => (value: string, index: number) => {
    const emails = members.map((member) => member.email);
    const valueIndex = emails.indexOf(value);

    return valueIndex >= 0 && valueIndex !== index;
  };

export default InviteMembersForm;
