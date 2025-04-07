"use client";

import { joinWaitlistInput } from "@kyh/api/waitlist/waitlist-schema";
import { Button } from "@kyh/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@kyh/ui/form";
import { toast } from "@kyh/ui/toast";
import { cn } from "@kyh/ui/utils";
import { useMutation } from "@tanstack/react-query";

import type { JoinWaitlistInput } from "@kyh/api/waitlist/waitlist-schema";
import { useTRPC } from "@/trpc/react";

export const WaitlistForm = () => {
  const trpc = useTRPC();
  const joinWaitlist = useMutation(trpc.waitlist.join.mutationOptions());

  const form = useForm({
    schema: joinWaitlistInput,
    defaultValues: {
      email: "",
    },
  });

  const handleJoinWaitlist = (values: JoinWaitlistInput) => {
    toast.promise(
      joinWaitlist
        .mutateAsync({ type: "app", email: values.email })
        .then(() => {
          form.reset({ email: "" });
        }),
      {
        loading: "Submitting...",
        success: "Waitlist joined!",
        error: "Failed to join waitlist",
      },
    );
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleJoinWaitlist)}
        className="bg-input mt-10 flex max-w-sm items-center gap-2 rounded-xl border border-white/10 shadow-lg"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1 space-y-0">
              <FormLabel className="sr-only">Email</FormLabel>
              <FormControl>
                <input
                  className="w-full border-none bg-transparent py-3 pl-4 text-sm placeholder-white/50 focus:placeholder-white/75 focus:ring-0 focus:outline-hidden"
                  required
                  type="email"
                  placeholder="name@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect="off"
                  {...field}
                />
              </FormControl>
              <FormMessage className="absolute pt-1" />
            </FormItem>
          )}
        />
        <Button
          className={cn(
            "text-xs",
            joinWaitlist.isPending && "[&>:first-child]:bg-input",
          )}
          variant="ghost"
          loading={joinWaitlist.isPending}
        >
          Join Waitlist
        </Button>
      </form>
    </Form>
  );
};
