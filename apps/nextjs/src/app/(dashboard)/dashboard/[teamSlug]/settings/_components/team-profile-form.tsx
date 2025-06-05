"use client";

import { useRouter } from "next/navigation";
import { updateTeamInput } from "@repo/api/team/team-schema";
import { Button } from "@repo/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@repo/ui/form";
import { Input } from "@repo/ui/input";
import { toast } from "@repo/ui/toast";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";

import type { UpdateTeamInput } from "@repo/api/team/team-schema";
import { useTRPC } from "@/trpc/react";

type TeamProfileFormProps = {
  teamSlug: string;
};

export const TeamProfileForm = ({ teamSlug }: TeamProfileFormProps) => {
  const trpc = useTRPC();
  const router = useRouter();
  const {
    data: { team },
  } = useSuspenseQuery(trpc.team.getTeam.queryOptions({ slug: teamSlug }));

  const updateTeam = useMutation(
    trpc.team.updateTeam.mutationOptions({
      onSuccess: ({ team }) => {
        if (!team) return;
        router.replace(`/dashboard/${team.slug}/settings`);
      },
    }),
  );

  const form = useForm({
    schema: updateTeamInput,
    defaultValues: {
      id: team?.id,
      name: team?.name,
      slug: team?.slug,
    },
  });

  const onSubmit = (data: UpdateTeamInput) => {
    const promise = updateTeam.mutateAsync(data);
    toast.promise(promise, {
      loading: "Updating team...",
      success: "Team successfully updated",
      error: "Could not update team. Please try again.",
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Team Name</FormLabel>
              <FormControl>
                <Input required {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Team URL</FormLabel>
              <FormControl>
                <div className="flex rounded-lg shadow-sm shadow-black/[.04]">
                  <span className="border-input bg-background text-muted-foreground -z-10 inline-flex items-center rounded-s-lg border px-3 text-sm">
                    dashboard/
                  </span>
                  <Input
                    className="-ms-px rounded-s-none shadow-none"
                    required
                    {...field}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <footer className="flex justify-end">
          <Button type="submit" loading={updateTeam.isPending}>
            Update Team
          </Button>
        </footer>
      </form>
    </Form>
  );
};
