"use client";

import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const WaitlistForm = ({ defaultEmail }: { defaultEmail?: string }) => {
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    await sleep(5000);
    toast.success("You have joined the waitlist");

    setLoading(false);
  };

  return (
    <form
      className="p-2 border border-white/10 bg-brand-800 shadow-big rounded-xl sm:max-w-sm sm:flex"
      onSubmit={onSubmit}
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
        <Button type="submit" loading={loading}>
          Join Waitlist
        </Button>
      </div>
    </form>
  );
};
