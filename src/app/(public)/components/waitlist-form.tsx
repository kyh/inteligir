"use client";

import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { register } from "./waitlist-actions";
import { useServerAction } from "~/lib/use-actions";

export const WaitlistForm = ({ defaultEmail }: { defaultEmail?: string }) => {
  const { mutate, data, error, loading } = useServerAction(register);

  console.log("loading", loading);
  if (loading) return <div>Loading...</div>;

  if (data) return <div>Success!</div>;

  return (
    <form
      className="p-2 border border-white/10 bg-brand-800 shadow-big rounded-xl sm:max-w-sm sm:flex"
      action={mutate}
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
        />
      </div>
      <div className="mt-4 sm:mt-0 sm:ml-3">
        <Button type="submit" loading={loading}>
          Join Waitlist
        </Button>
      </div>
    </form>
  );
};
