import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/gotrue-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import configuration from "~/configuration";
import { useForm } from "react-hook-form";
import toaster from "react-hot-toast";
import useMutation from "swr/mutation";
import useSupabase from "~/core/hooks/use-supabase";
import type UserData from "~/core/session/types/user-data";
import type UserSession from "~/core/session/types/user-session";
import useUpdateProfileMutation from "~/lib/user/hooks/use-update-profile";
import { Button } from "~/components/Button";
import If from "~/components/If";
import ImageUploadInput from "~/components/ImageUploadInput";
import Modal from "~/components/Modal";
import { TextField } from "~/components/TextField";
import AuthErrorMessage from "~/app/auth/components/AuthErrorMessage";

function UpdateProfileForm({
  session,
  onUpdateProfileData,
  onUpdateAuthData,
}: {
  session: UserSession;
  onUpdateProfileData: (user: Partial<UserData>) => void;
  onUpdateAuthData: (data: Partial<User>) => void;
}) {
  const client = useSupabase();
  const updateProfileMutation = useUpdateProfileMutation();

  const currentPhotoURL = session.data?.photoUrl ?? "";
  const currentDisplayName = session?.data?.displayName ?? "";

  const user = session.auth?.user;
  const currentPhoneNumber = user?.phone ?? "";
  const email = user?.email ?? "";

  const { register, handleSubmit, reset, setValue } = useForm({
    defaultValues: {
      displayName: currentDisplayName,
      photoURL: "",
    },
  });

  const [avatarIsDirty, setAvatarIsDirty] = useState(false);

  const onAvatarCleared = useCallback(() => {
    setAvatarIsDirty(true);
    setValue("photoURL", "");
  }, [setValue]);

  const onSubmit = async (displayName: string, photoFile: Maybe<File>) => {
    const photoName = photoFile?.name;

    if (!user?.id) {
      return;
    }

    const photoUrl = photoName
      ? await uploadUserProfilePhoto(client, photoFile, user.id)
      : currentPhotoURL;

    const isAvatarRemoved = avatarIsDirty && !photoName;

    const info = {
      id: user.id,
      displayName,
      photoUrl: isAvatarRemoved ? "" : photoUrl,
    };

    // delete existing photo if different
    if (isAvatarRemoved) {
      try {
        await deleteProfilePhoto(client, currentPhotoURL);
      } catch (e) {
        // old photo not found
      }
    }

    const promise = updateProfileMutation.trigger(info).then(() => {
      onUpdateProfileData(info);
    });

    return toaster.promise(promise, {
      loading: "Updating profile...",
      success: "Profile updated successfully",
      error: "Error updating profile",
    });
  };

  const displayNameControl = register("displayName", {
    value: currentDisplayName,
  });

  const photoURLControl = register("photoURL");

  useEffect(() => {
    reset({
      displayName: currentDisplayName ?? "",
      photoURL: currentPhotoURL ?? "",
    });
  }, [currentDisplayName, currentPhotoURL, reset]);

  return (
    <>
      <form
        data-cy="update-profile-form"
        onSubmit={handleSubmit((value) => {
          return onSubmit(value.displayName, getPhotoFile(value.photoURL));
        })}
      >
        <div className="flex flex-col space-y-4">
          <TextField>
            <TextField.Label>
              Your Name
              <TextField.Input
                {...displayNameControl}
                data-cy="profile-display-name"
                minLength={2}
                placeholder=""
              />
            </TextField.Label>
          </TextField>

          <TextField>
            <TextField.Label>
              Your Photo
              <ImageUploadInput
                {...photoURLControl}
                multiple={false}
                onClear={onAvatarCleared}
                image={currentPhotoURL}
              >
                Click here to upload an image
              </ImageUploadInput>
            </TextField.Label>
          </TextField>

          <TextField>
            <TextField.Label>
              Email Address
              <TextField.Input disabled value={email} />
            </TextField.Label>

            <If condition={email}>
              <div>
                <Button as={Link} href="/settings/profile/email">
                  <span className="text-xs font-normal">
                    Update Email Address
                  </span>
                </Button>
              </div>
            </If>

            <If condition={!email}>
              <div>
                <Button as={Link} href="/settings/profile/authentication">
                  <span className="text-xs font-normal">Add Email address</span>
                </Button>
              </div>
            </If>
          </TextField>

          <TextField>
            <TextField.Label>
              Phone Number
              <TextField.Input disabled value={currentPhoneNumber} />
            </TextField.Label>

            {/* Only show this if phone number is enabled */}
            <If condition={configuration.auth.providers.phoneNumber}>
              <div>
                <If condition={currentPhoneNumber}>
                  <RemovePhoneNumberButton
                    onSuccess={() => {
                      onUpdateAuthData({
                        phone: undefined,
                      });
                    }}
                  />
                </If>
              </div>
            </If>
          </TextField>

          <div>
            <Button
              className="w-full md:w-auto"
              loading={updateProfileMutation.isMutating}
            >
              Update Profile
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}

/**
 * @name getPhotoFile
 * @param value
 * @description Returns the file of the photo when submitted
 * It returns undefined when the user hasn't selected a file
 */
function getPhotoFile(value: string | null | FileList) {
  if (!value || typeof value === "string") {
    return;
  }

  return value.item(0) ?? undefined;
}

async function uploadUserProfilePhoto(
  client: SupabaseClient,
  photoFile: File,
  userId: string
) {
  const bytes = await photoFile.arrayBuffer();
  const bucket = client.storage.from("avatars");
  const extension = photoFile.name.split(".").pop();
  const fileName = `${userId}.${extension}`;

  const result = await bucket.upload(fileName, bytes, {
    upsert: true,
  });

  if (!result.error) {
    return bucket.getPublicUrl(fileName).data.publicUrl;
  }

  throw result.error;
}

function deleteProfilePhoto(client: SupabaseClient, url: string) {
  const bucket = client.storage.from("logos");
  return bucket.remove([url]);
}

function RemovePhoneNumberButton({
  onSuccess,
}: React.PropsWithChildren<{
  onSuccess: () => void;
}>) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const unlinkProfileNumberMutation = useUnlinkProfilePhone();

  const onUnlinkPhoneNumber = useCallback(() => {
    const promise = unlinkProfileNumberMutation.trigger().then(() => {
      setIsModalOpen(false);
      onSuccess();
    });

    return toaster.promise(promise, {
      loading: "Unlinking phone number...",
      success: "Phone number unlinked successfully",
      error: "Error unlinking phone number",
    });
  }, [unlinkProfileNumberMutation, onSuccess]);

  return (
    <>
      <Button type="button" onClick={() => setIsModalOpen(true)}>
        <span className="text-xs font-normal">Unlink Phone</span>
      </Button>

      <Modal
        heading="Unlink Phone Number"
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
      >
        <div className="flex flex-col space-y-3">
          <div>Are you sure you want to continue?</div>
          <AuthErrorMessage error={unlinkProfileNumberMutation.error} />
          <Button
            loading={unlinkProfileNumberMutation.isMutating}
            onClick={onUnlinkPhoneNumber}
          >
            Unlink Phone
          </Button>
        </div>
      </Modal>
    </>
  );
}

function useUnlinkProfilePhone() {
  const client = useSupabase();
  const key = "unlinkProfilePhone";

  return useMutation(key, async () => {
    return client.auth
      .updateUser({
        phone: undefined,
      })
      .then((response) => {
        if (response.error) {
          throw response.error;
        }

        return response.data;
      });
  });
}

export default UpdateProfileForm;
