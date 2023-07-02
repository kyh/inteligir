"use client";

import { useCallback, type FormEvent } from "react";
import { ArrowRightIcon } from "lucide-react";
import useUserSession from "~/core/hooks/use-user-session";
import { Button } from "~/components/Button";
import { Text } from "~/components/Text";
import { TextField } from "~/components/TextField";

export type OrganizationInfoStepData = {
  organization: string;
};

const OrganizationInfoStep: React.FCC<{
  onSubmit: (data: OrganizationInfoStepData) => void;
}> = ({ onSubmit }) => {
  const user = useUserSession();
  const displayName = user?.data?.displayName ?? user?.auth?.user.email ?? "";

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const data = new FormData(event.currentTarget);
      const organization = data.get(`organization`) as string;

      onSubmit({
        organization,
      });
    },
    [onSubmit]
  );

  return (
    <form
      onSubmit={handleFormSubmit}
      className="flex w-full flex-1 flex-col space-y-6"
    >
      <div className="flex flex-col space-y-1.5">
        <Text as="h1" variant="heading2">
          Hi, {displayName}
        </Text>
        <Text as="p">Let&apos;s create your organization.</Text>
      </div>

      <div className="flex flex-1 flex-col space-y-2">
        <TextField>
          <TextField.Label>
            Your organization&apos;s name
            <TextField.Input
              required
              name="organization"
              placeholder="Organization Name"
            />
          </TextField.Label>
        </TextField>

        <div>
          <Button type="submit">
            <span className="flex items-center space-x-2">
              <span>Continue</span>
              <ArrowRightIcon className="h-5" />
            </span>
          </Button>
        </div>
      </div>
    </form>
  );
};

export default OrganizationInfoStep;
