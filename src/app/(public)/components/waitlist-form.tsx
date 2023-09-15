"use client";

import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { experimental_useFormStatus as useFormStatus } from "react-dom";
import { joinWaitlist } from "./actions";

export const WaitlistForm = ({ defaultEmail }: { defaultEmail?: string }) => {
  return (
    <form
      className="p-2 border border-white/10 bg-brand-800 shadow-big rounded-xl sm:max-w-sm sm:flex"
      action={joinWaitlist}
    >
      <div className="flex-1 min-w-0">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <Input
          name="email"
          id="email"
          type="email"
          placeholder="Your email..."
          defaultValue={defaultEmail || ""}
          variant="ghost"
        />
      </div>
      <div className="mt-4 sm:mt-0 sm:ml-3">
        <ActionButton />
      </div>
    </form>
  );
};

const ActionButton = () => {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending}>
      Join Waitlist
    </Button>
  );
};
