"use client";

import { Button } from "ui/components/button";
import { experimental_useFormStatus as useFormStatus } from "react-dom";
import { joinWaitlist } from "../actions";

export const WaitlistForm = ({ defaultEmail }: { defaultEmail?: string }) => {
  return (
    <form
      className="items-center gap-2 rounded-xl border border-white/10 bg-brand-800 px-2 py-1 shadow-big sm:flex sm:max-w-sm"
      action={joinWaitlist}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          className="w-full border-none bg-transparent placeholder-white/50 placeholder:text-xs focus:placeholder-white/75 focus:outline-none focus:ring-0"
          name="email"
          id="email"
          type="email"
          placeholder="Your email..."
          defaultValue={defaultEmail || ""}
        />
      </div>
      <div className="mt-4 sm:mt-0">
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
