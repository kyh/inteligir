"use client";

import { useCallback, useContext, useEffect } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import useSupabase from "~/core/hooks/use-supabase";
import OrganizationContext from "~/lib/contexts/organization";
import type { DatabaseClient } from "~/lib/db";
import useUpdateOrganizationMutation from "~/lib/organizations/hooks/use-update-organization-mutation";
import type Organization from "~/lib/organizations/types/organization";
import { Button } from "~/components/Button";
import ImageUploadInput from "~/components/ImageUploadInput";
import { TextField } from "~/components/TextField";

const UpdateOrganizationForm = () => {
  const client = useSupabase();

  const { organization, setOrganization } = useContext(OrganizationContext);
  const updateOrganizationMutation = useUpdateOrganizationMutation();

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
        const errorMessage = "Organization not found";
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
          toast.error("Logo not uploaded. Please try again.");
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
        loading: "Updating organization...",
        success: "Organization updated successfully",
        error: "Organization not updated. Please try again.",
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
      setOrganization,
    ]
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
      onSubmit={handleSubmit((value) => {
        return onSubmit(value.name, getLogoFile(value.logoURL));
      })}
      className="space-y-4"
    >
      <div className="flex flex-col space-y-4">
        <TextField>
          <TextField.Label>
            Organization Name
            <TextField.Input
              {...nameControl}
              data-cy="organization-name-input"
              required
              placeholder="ex. IndieCorp"
            />
          </TextField.Label>
        </TextField>

        <TextField.Label>
          Organization Logo
          <ImageUploadInput
            {...logoControl}
            multiple={false}
            image={currentLogoUrl}
            onClear={() => setValue("logoURL", "")}
          >
            Click here to upload an image
          </ImageUploadInput>
        </TextField.Label>

        <div>
          <Button
            className="w-full md:w-auto"
            data-cy="update-organization-submit-button"
            loading={updateOrganizationMutation.isMutating}
          >
            Update Organization
          </Button>
        </div>
      </div>
    </form>
  );
};

async function uploadLogo({
  client,
  organizationId,
  logo,
}: {
  client: DatabaseClient;
  organizationId: number;
  logo: File;
}) {
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
}

function getLogoName(fileName: string, organizationId: number) {
  const extension = fileName.split(".").pop();

  return `${organizationId}.${extension}`;
}

function getLogoFile(value: string | null | FileList) {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    return new File([], value);
  }

  return value.item(0) ?? undefined;
}

export default UpdateOrganizationForm;
