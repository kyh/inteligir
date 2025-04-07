"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createTeamInput } from "@kyh/api/team/team-schema";
import { ProfileAvatar } from "@kyh/ui/avatar";
import { Button } from "@kyh/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@kyh/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@kyh/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@kyh/ui/form";
import { Input } from "@kyh/ui/input";
import { Logo } from "@kyh/ui/logo";
import { toast } from "@kyh/ui/toast";
import { cn } from "@kyh/ui/utils";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  CreditCardIcon,
  HomeIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
  Users2Icon,
} from "lucide-react";

import { NavLink } from "@/components/nav";
import { useTRPC } from "@/trpc/react";

export const Sidebar = () => {
  const trpc = useTRPC();
  const params = useParams<{ teamSlug: string | undefined }>();
  const {
    data: { defaultTeamSlug },
  } = useSuspenseQuery(trpc.auth.workspace.queryOptions());

  const rootUrl = `/dashboard/${params.teamSlug ?? defaultTeamSlug}`;
  const pageLinks = [
    {
      href: rootUrl,
      label: "Home",
      exact: true,
      icon: HomeIcon,
    },
    {
      href: `${rootUrl}/members`,
      label: "Members",
      icon: Users2Icon,
    },
    {
      href: `${rootUrl}/billing`,
      label: "Billing",
      icon: CreditCardIcon,
    },
    {
      href: `${rootUrl}/settings`,
      label: "Settings",
      icon: SettingsIcon,
    },
  ];

  return (
    <nav className="sticky top-0 flex h-dvh w-[80px] flex-col items-center overflow-x-hidden overflow-y-auto px-4 py-[26px]">
      <div className="flex flex-col">
        <div className="flex justify-center pb-2">
          <NavLink href={rootUrl}>
            <Logo className="bg-muted text-primary size-10 rounded-lg" />
            <span className="sr-only">Init</span>
          </NavLink>
        </div>
        {pageLinks.map((link) => (
          <NavLink
            key={link.href}
            href={link.href}
            exact={link.exact}
            className="group flex flex-col items-center gap-1 p-2 text-xs"
          >
            <span className="group-hover:bg-secondary group-data-[state=active]:bg-secondary flex size-9 items-center justify-center rounded-lg transition">
              <link.icon className="size-4" />
            </span>
            <span>{link.label}</span>
          </NavLink>
        ))}
      </div>
      <UserDropdown teamSlug={params.teamSlug} />
    </nav>
  );
};

export const UserDropdown = ({ teamSlug }: { teamSlug?: string }) => {
  const trpc = useTRPC();
  const router = useRouter();
  const {
    data: { user, userMetadata, teams },
  } = useSuspenseQuery(trpc.auth.workspace.queryOptions());

  const signOut = useMutation(
    trpc.auth.signOut.mutationOptions({
      onSuccess: () => {
        router.replace("/");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const createTeamAccount = useMutation(
    trpc.team.createTeam.mutationOptions({
      onSuccess: ({ team }) => {
        toast.success("Team created successfully");
        router.push(`/dashboard/${team.slug}`);
      },
      onError: () =>
        toast.error(
          "We encountered an error creating your team. Please try again.",
        ),
    }),
  );

  const form = useForm({
    schema: createTeamInput,
    defaultValues: {
      name: "",
    },
  });

  if (!user) return null;

  return (
    <Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger className="mt-auto cursor-pointer">
          <ProfileAvatar
            displayName={userMetadata?.displayName ?? user.email}
            avatarUrl={userMetadata?.avatarUrl}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-56"
          forceMount
          alignOffset={8}
          sideOffset={8}
          collisionPadding={8}
        >
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-1">
              <p className="text-sm leading-none font-medium">
                {userMetadata?.displayName ?? user.email}
              </p>
              {userMetadata?.displayName && (
                <p className="text-muted-foreground text-xs leading-none">
                  {user.email}
                </p>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/account">Account Settings</Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Switch Teams</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {teams.map((team) => (
                  <DropdownMenuItem key={team.id} asChild>
                    <Link
                      href={`/dashboard/${team.slug}`}
                      className="inline-flex w-full items-center font-normal"
                    >
                      <ProfileAvatar
                        className="size-4"
                        displayName={team.name}
                        avatarUrl={team.avatarUrl}
                      />
                      <span className="ml-2">{team.name}</span>
                      <CheckIcon
                        className={cn(
                          "ml-auto size-4",
                          teamSlug === team.slug ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DialogTrigger asChild>
                  <DropdownMenuItem className="flex w-full gap-2" asChild>
                    <button type="button">
                      <PlusIcon className="size-4" />
                      Create a Team
                    </button>
                  </DropdownMenuItem>
                </DialogTrigger>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <button
              className="flex w-full gap-2"
              onClick={() => signOut.mutate()}
            >
              <LogOutIcon className="size-4" />
              Log out
            </button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
          <DialogDescription>
            Create a new Team to manage your projects and members.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => {
              createTeamAccount.mutate(data);
            })}
          >
            <div className="flex flex-col gap-4">
              <FormField
                name="name"
                render={({ field }) => {
                  return (
                    <FormItem>
                      <FormLabel>Team Name</FormLabel>
                      <FormControl>
                        <Input
                          required
                          minLength={2}
                          maxLength={50}
                          placeholder=""
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <div className="flex justify-end gap-2">
                <Button loading={createTeamAccount.isPending}>
                  Create Team
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
