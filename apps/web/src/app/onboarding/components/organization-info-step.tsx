"use client";

import type { FormEvent } from "react";
import { useCallback } from "react";
import { ArrowRightMini } from "@inteligir/icons";
import Heading from "@inteligir/ui/heading";
import Button from "@inteligir/ui/button";
import TextField from "@inteligir/ui/text-field";
import SubHeading from "@inteligir/ui/sub-heading";
import useUserSession from "@/features/user/use-user-session";

export type OrganizationInfoStepData = {
  organization: string;
};

const OrganizationInfoStep: React.FCC<{
  onSubmit: (data: OrganizationInfoStepData) => void;
}> = ({ onSubmit }) => {
  const user = useUserSession();
  const displayName = user?.auth.user.email || "";

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const data = new FormData(event.currentTarget);
      const organization = data.get(`organization`) as string;

      onSubmit({
        organization,
      });
    },
    [onSubmit],
  );

  return (
    <form
      className="flex w-full flex-1 flex-col space-y-6"
      onSubmit={handleFormSubmit}
    >
      <div className="flex flex-col space-y-1.5">
        <Heading type={2}>Hi, {displayName}</Heading>
        <SubHeading>Let&apos;s create your organization.</SubHeading>
      </div>

      <div className="flex flex-1 flex-col space-y-2">
        <TextField>
          <TextField.Label>
            Your organization&apos;s name
            <TextField.Input
              name="organization"
              placeholder="Organization Name"
              required
            />
          </TextField.Label>
        </TextField>

        <div>
          <Button type="submit">
            <span className="flex items-center space-x-2">
              <span>Continue</span>
              <ArrowRightMini className="h-5" />
            </span>
          </Button>
        </div>
      </div>
    </form>
  );
};

export default OrganizationInfoStep;
