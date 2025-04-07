"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@kyh/ui/alert-dialog";
import { Button } from "@kyh/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@kyh/ui/form";
import { Input } from "@kyh/ui/input";
import { toast } from "@kyh/ui/toast";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";

import type { RouterOutputs } from "@kyh/api";
import { useTRPC } from "@/trpc/react";

type TeamDeleteFormProps = {
  teamSlug: string;
};

export const TeamDeleteForm = ({ teamSlug }: TeamDeleteFormProps) => {
  const trpc = useTRPC();
  const {
    data: { user, teams },
  } = useSuspenseQuery(trpc.auth.workspace.queryOptions());
  const {
    data: { team },
  } = useSuspenseQuery(trpc.team.getTeam.queryOptions({ slug: teamSlug }));

  const currentTeam = teams.find((t) => t.id === team?.id);

  if (!currentTeam || !user) {
    return null;
  }

  // Only the primary owner can delete the team
  const userIsPrimaryOwner = currentTeam.userRole === "owner";
  if (userIsPrimaryOwner) {
    return <Delete team={currentTeam} />;
  }

  // A primary owner can't leave the team account
  // but other members can
  return <Leave user={user} team={currentTeam} />;
};

type DeleteProps = {
  team: NonNullable<RouterOutputs["auth"]["workspace"]["teams"][number]>;
};

const Delete = ({ team }: DeleteProps) => {
  const trpc = useTRPC();
  const deleteTeam = useMutation(trpc.team.deleteTeam.mutationOptions());

  const form = useForm({
    mode: "onChange",
    reValidateMode: "onChange",
    schema: z.object({
      name: z.string().refine((value) => value === team.name, {
        message: "Name does not match",
        path: ["name"],
      }),
    }),
    defaultValues: {
      name: "",
    },
  });

  const onSubmit = () => {
    const promise = deleteTeam.mutateAsync({ id: team.id });
    toast.promise(promise, {
      loading: "Deleting team...",
      success: "Team successfully deleted",
      error: "Could not delete the team. Please try again.",
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-medium">Delete Team</span>
        <p className="text-muted-foreground text-sm">
          You are about to delete the team {team.name}. This action cannot be
          undone.
        </p>
      </div>
      <div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive">
              Delete Team
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deleting team</AlertDialogTitle>
              <AlertDialogDescription>
                You are about to delete the team {team.name}. This action cannot
                be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Form {...form}>
              <form className="flex flex-col gap-4" onSubmit={onSubmit}>
                <div className="flex flex-col gap-2">
                  <div className="my-4 flex flex-col gap-2 border-2 border-red-500 p-4 text-sm text-red-500">
                    <div>
                      You are deleting the team {team.name}. This action cannot
                      be undone.
                    </div>
                    <div className="text-sm">
                      Are you sure you want to continue?
                    </div>
                  </div>
                  <FormField
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Team Name</FormLabel>
                        <FormControl>
                          <Input
                            required
                            type="text"
                            autoComplete="off"
                            className="w-full"
                            placeholder=""
                            pattern={team.name}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Type the name of the team to confirm
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                    name="confirm"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button loading={deleteTeam.isPending} variant="destructive">
                    Delete Team
                  </Button>
                </AlertDialogFooter>
              </form>
            </Form>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

type LeaveProps = {
  user: NonNullable<RouterOutputs["auth"]["workspace"]["user"]>;
  team: NonNullable<RouterOutputs["auth"]["workspace"]["teams"][number]>;
};

const Leave = ({ user, team }: LeaveProps) => {
  const trpc = useTRPC();
  const leaveTeam = useMutation(trpc.team.deleteTeamMember.mutationOptions());

  const form = useForm({
    schema: z.object({
      confirmation: z.string().refine((value) => value === "LEAVE", {
        message: "Confirmation required to leave team",
        path: ["confirmation"],
      }),
    }),
    defaultValues: {
      confirmation: "",
    },
  });

  const onSubmit = () => {
    const promise = leaveTeam.mutateAsync({ userId: user.id, teamId: team.id });
    toast.promise(promise, {
      loading: "Leaving team...",
      success: "Team successfully left",
      error: "Could not leave the team. Please try again.",
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Click the button below to leave the team. Remember, you will no longer
        have access to it and will need to be re-invited to join
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive">
            Leave Team
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leaving Team</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to leave this team. You will no longer have access
              to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Form {...form}>
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <FormField
                name="confirmation"
                render={({ field }) => {
                  return (
                    <FormItem>
                      <FormLabel>
                        Please type LEAVE to confirm leaving the team.
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          className="w-full"
                          autoComplete="off"
                          placeholder=""
                          pattern="LEAVE"
                          required
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        By leaving the team, you will no longer have access to
                        it.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button loading={leaveTeam.isPending} variant="destructive">
                  Leave Team
                </Button>
              </AlertDialogFooter>
            </form>
          </Form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
