"use client";

import { useTranslation } from "react-i18next";
import { Fragment } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import PlusCircleIcon from "@heroicons/react/24/outline/PlusCircleIcon";
import XMarkIcon from "@heroicons/react/24/outline/XMarkIcon";

import MembershipRole from "~/lib/organizations/types/membership-role";
import useInviteMembers from "~/lib/organizations/hooks/use-invite-members-mutation";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/core/ui/Tooltip";
import If from "~/core/ui/If";
import TextField from "~/core/ui/TextField";
import Button from "~/core/ui/Button";
import IconButton from "~/core/ui/IconButton";

import MembershipRoleSelector from "./MembershipRoleSelector";
import useUserSession from "~/core/hooks/use-user-session";
import Trans from "~/core/ui/Trans";

type InviteModel = ReturnType<typeof memberFactory>;

const InviteMembersForm = () => {
  const { t } = useTranslation("organization");
  const user = useUserSession();
  const inviteMembers = useInviteMembers();
  const submitting = inviteMembers.isMutating;

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
          return inviteMembers.trigger(data.members);
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
                return t<string>(`duplicateInviteEmailError`);
              }

              const isSameAsCurrentUserEmail = user?.auth?.user.email === value;

              if (isSameAsCurrentUserEmail) {
                return t<string>(`invitingOwnAccountError`);
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
                <div className="w-7/12 md:w-8/12">
                  <TextField.Input
                    {...emailControl}
                    data-cy="invite-email-input"
                    placeholder="member@email.com"
                    type="email"
                    required
                  />
                </div>

                <div className="w-4/12 md:w-3/12">
                  <MembershipRoleSelector
                    value={field.role}
                    onChange={(role) => {
                      setValue(roleInputName, role);
                    }}
                  />
                </div>

                <If condition={fields.length > 1}>
                  <div className="w-1/12">
                    <Tooltip className="flex justify-center">
                      <TooltipTrigger asChild>
                        <IconButton
                          data-cy="remove-invite-button"
                          label={t<string>("removeInviteButtonLabel")}
                          onClick={() => {
                            remove(index);
                            clearErrors(emailInputName);
                          }}
                        >
                          <XMarkIcon className="h-4 lg:h-5" />
                        </IconButton>
                      </TooltipTrigger>

                      <TooltipContent>
                        {t("removeInviteButtonLabel")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </If>
              </div>
            </Fragment>
          );
        })}

        <div>
          <Button
            data-cy="append-new-invite-button"
            type="button"
            color="transparent"
            size="small"
            onClick={() => append(memberFactory())}
          >
            <span className="flex items-center space-x-2">
              <PlusCircleIcon className="h-5" />

              <span>
                <Trans i18nKey="organization:addAnotherMemberButtonLabel" />
              </span>
            </span>
          </Button>
        </div>
      </div>

      <div>
        <Button
          loading={submitting}
          className="w-full lg:w-auto"
          data-cy="send-invites-button"
          type="submit"
        >
          {submitting ? (
            <Trans i18nKey="organization:inviteMembersLoading" />
          ) : (
            <Trans i18nKey="organization:inviteMembersSubmitLabel" />
          )}
        </Button>
      </div>
    </form>
  );
};

function memberFactory() {
  return {
    email: "",
    role: MembershipRole.Member,
  };
}

function useInviteMembersForm() {
  return useForm({
    defaultValues: {
      members: [memberFactory()],
    },
    shouldUseNativeValidation: true,
    shouldFocusError: true,
    shouldUnregister: true,
  });
}

function getFormValidator(members: InviteModel[]) {
  return function isValueInvalid(value: string, index: number) {
    const emails = members.map((member) => member.email);
    const valueIndex = emails.indexOf(value);

    return valueIndex >= 0 && valueIndex !== index;
  };
}

export default InviteMembersForm;
