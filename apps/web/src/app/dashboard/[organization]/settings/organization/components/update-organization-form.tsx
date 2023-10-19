"use client";

import { useCallback, useContext, useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import type { SupabaseClient } from "@supabase/supabase-js";
import OrganizationContext from "@/features/organizations/organization-provider";
import useSupabase from "@/lib/supabase/use-supabase";
import useUpdateOrganizationMutation from "@/lib/organizations/hooks/use-update-organization-mutation";
import Button from "ui/components/Button";
import TextField from "ui/components/TextField";
import ImageUploadInput from "ui/components/ImageUploadInput";
import Label from "ui/components/Label";
import Trans from "ui/components/Trans";
import type Organization from "@/lib/organizations/types/organization";

const UpdateOrganizationForm = () => {
  const client = useSupabase();

  const { organization, setOrganization } = useContext(OrganizationContext);
  const updateOrganizationMutation = useUpdateOrganizationMutation();
  const { t } = useTranslation("organization");

  const currentOrganizationName = organization?.name ?? "";
  const currentLogoUrl = organization?.logoURL || null;

  const { register, handleSubmit, reset, setValue } = useForm({
    defaultValues: {
      name: currentOrganizationName,
      logoURL: currentLogoUrl,
    },
  });

  const onSubmit = useCallback(
    async (organizationName: string, logoFile: Maybe<File>) => {
      const organizationId = organization?.id;

      if (!organizationId) {
        const errorMessage = t(`updateOrganizationErrorMessage`);

        return toast.error(errorMessage);
      }

      const logoName = logoFile?.name;

      let logoURL: string | null | undefined;

      // if the logo is provided and differs from the existing one
      // upload it to the storage
      if (logoName && logoName !== currentLogoUrl) {
        logoURL = await uploadLogo({
          client,
          logo: logoFile,
          organizationId,
        }).catch(() => {
          toast.error(t(`updateLogoErrorMessage`));

          return null;
        });
      }

      if (!logoName && currentLogoUrl) {
        // if the user removed the logo
        logoURL = null;
      }

      const organizationData: WithId<Partial<Organization>> = {
        id: organization.id,
        name: organizationName,
      };

      if (logoURL !== undefined) {
        organizationData.logoURL = logoURL;
      }

      const promise = updateOrganizationMutation.trigger(organizationData);

      await toast.promise(promise, {
        loading: t(`updateOrganizationLoadingMessage`),
        success: t(`updateOrganizationSuccessMessage`),
        error: t(`updateOrganizationErrorMessage`),
      });

      setOrganization({
        ...organization,
        name: organizationName,
        logoURL: logoURL ?? organization.logoURL,
      });
    },
    [
      organization,
      client,
      currentLogoUrl,
      updateOrganizationMutation,
      t,
      setOrganization,
    ],
  );

  useEffect(() => {
    reset({
      name: organization?.name,
      logoURL: organization?.logoURL,
    });
  }, [organization, reset]);

  const nameControl = register("name", {
    required: true,
  });

  const logoControl = register("logoURL");

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((value) => {
        return onSubmit(value.name, getLogoFile(value.logoURL));
      })}
    >
      <div className="flex flex-col space-y-4">
        <TextField>
          <TextField.Label>
            <Trans i18nKey="organization:organizationNameInputLabel" />

            <TextField.Input
              {...nameControl}
              data-cy="organization-name-input"
              placeholder="ex. IndieCorp"
              required
            />
          </TextField.Label>
        </TextField>

        <Label>
          <Trans i18nKey="organization:organizationLogoInputLabel" />

          <ImageUploadInput
            {...logoControl}
            image={currentLogoUrl}
            multiple={false}
            onClear={() => {
              setValue("logoURL", "");
            }}
          >
            <Trans i18nKey="common:imageInputLabel" />
          </ImageUploadInput>
        </Label>

        <div>
          <Button
            className="w-full md:w-auto"
            data-cy="update-organization-submit-button"
            loading={updateOrganizationMutation.isMutating}
          >
            <Trans i18nKey="organization:updateOrganizationSubmitLabel" />
          </Button>
        </div>
      </div>
    </form>
  );
};

/**
 * @description Upload file to Storage
 * @param client
 * @param organizationId
 * @param logo
 */
const uploadLogo = async ({
  client,
  organizationId,
  logo,
}: {
  client: SupabaseClient;
  organizationId: number;
  logo: File;
}) => {
  const bytes = await logo.arrayBuffer();
  const bucket = client.storage.from("logos");
  const fileName = getLogoName(logo.name, organizationId);

  const result = await bucket.upload(fileName, bytes, {
    upsert: true,
    contentType: logo.type,
  });

  if (!result.error) {
    return bucket.getPublicUrl(fileName).data.publicUrl;
  }

  throw result.error;
};

const getLogoName = (fileName: string, organizationId: number) => {
  const extension = fileName.split(".").pop();

  return `${organizationId}.${extension}`;
};

const getLogoFile = (value: string | null | FileList) => {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    return new File([], value);
  }

  return value.item(0) ?? undefined;
};

export default UpdateOrganizationForm;
