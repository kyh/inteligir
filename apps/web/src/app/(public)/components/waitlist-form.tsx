"use client";

import { Input } from "ui/components/input";
import { Button } from "ui/components/button";
import { experimental_useFormStatus as useFormStatus } from "react-dom";
import { joinWaitlist } from "../lib/actions";

export const WaitlistForm = ({ defaultEmail }: { defaultEmail?: string }) => {
  return (
    <form
      className="bg-brand-800 shadow-big rounded-xl border border-white/10 p-2 sm:flex sm:max-w-sm"
      action={joinWaitlist}
    >
      <div className="min-w-0 flex-1">
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
      <div className="mt-4 sm:ml-3 sm:mt-0">
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
