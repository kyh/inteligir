"use client";

import { Button } from "ui/components/button";
import { experimental_useFormStatus as useFormStatus } from "react-dom";
import { joinWaitlist } from "../actions";

export const WaitlistForm = ({ defaultEmail }: { defaultEmail?: string }) => {
  return (
    <form
      className="items-center gap-2 rounded-xl border border-white/10 bg-ui-bg-component px-2 pb-2 pt-1 shadow-lg sm:flex sm:max-w-sm sm:py-1 sm:pl-1 sm:pr-2"
      action={joinWaitlist}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          className="w-full border-none bg-transparent text-sm placeholder-white/50 focus:placeholder-white/75 focus:outline-none focus:ring-0"
          name="email"
          id="email"
          type="email"
          placeholder="Your email..."
          defaultValue={defaultEmail || ""}
        />
      </div>
      <div className="mt-1 w-full sm:mt-0 sm:w-auto">
        <ActionButton />
      </div>
    </form>
  );
};

const ActionButton = () => {
  const { pending } = useFormStatus();

  return (
    <Button className="w-full" type="submit" size="sm" isLoading={pending}>
      Join Waitlist
    </Button>
  );
};
