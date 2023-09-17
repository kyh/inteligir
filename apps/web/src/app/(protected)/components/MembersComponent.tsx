"use client";
import { Avatar, AvatarFallback, AvatarImage } from "ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/components/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/components/tabs";
import { ROLES, ROLE_ADMIN, Role } from "@/lib/roles";
import { Loader2, MoreHorizontal, Plus } from "ui/icons";
import { useCallback, useState } from "react";
import { Input } from "ui/components/input";
import { Button } from "ui/components/button";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const InviteSection = ({ team, user }: { team: Team; user: Profile }) => {
  const [loading, setLoading] = useState(false);
  const [invites, setInvites] = useState([{ email: "", role: "MEMBER" }]);
  const { supabase } = useSupabase();
  const router = useRouter();

  const handleAddInvite = useCallback(() => {
    setInvites((invites) => [...invites, { email: "", role: "MEMBER" }]);
  }, []);

  const handleChangeEmail = useCallback((i: number, value: string) => {
    setInvites((invites) => {
      const newInvites = [...invites];
      const row = newInvites[i];
      if (row) {
        row.email = value;
      }
      return newInvites;
    });
  }, []);

  const handleChangeRole = useCallback((i: number, value: Role) => {
    setInvites((invites) => {
      const newInvites = [...invites];
      const row = newInvites[i];
      if (row) {
        row.role = value;
      }
      return newInvites;
    });
  }, []);

  const handleSendInvites = useCallback(async () => {
    if (!team) return;

    const invitesToCreate = invites.filter((invite) => invite.email);

    if (!invitesToCreate.length) {
      toast.error("Please enter at least one email");
      return;
    }

    setLoading(true);

    for (const invite of invitesToCreate) {
      const { error } = await supabase.from("invites").insert({
        team_id: team.id,
        email: invite.email,
        role: invite.role,
        user_id: user.id,
      });

      if (error) {
        console.error("Error adding invite:", error);
        return;
      }
    }

    toast.success("Your invites have been sent.");

    setInvites([{ email: "", role: "MEMBER" }]);

    router.refresh();

    setLoading(false);
  }, [user, team, supabase, invites, router]);

  return (
    <div className="rounded-lg border bg-white">
      <div className="px-6 py-4">
        <h3 className="text-lg font-medium">Invite</h3>
      </div>
      <div className="mt-1 flex flex-col gap-y-2 px-6">
        {invites.map(({ email, role }, i) => {
          return (
            <div key={i} className="grid grid-cols-3 gap-x-3">
              <div className="col-span-2">
                <Input
                  value={email}
                  id={`invite-email-${i}`}
                  type="text"
                  // autoComplete="new" prevents the browser from autofilling the field with the same email
                  autoComplete="new"
                  placeholder="Email"
                  className="w-full"
                  onChange={(e) => handleChangeEmail(i, e.target.value)}
                />
              </div>
              <div className="col-span-1">
                <Select
                  onValueChange={(v) => handleChangeRole(i, v as Role)}
                  defaultValue={role}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Admin" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => {
                      const formattedRole =
                        role.charAt(0).toUpperCase() +
                        role.slice(1).toLowerCase();
                      return (
                        <SelectItem key={role} value={role}>
                          {formattedRole}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>
      <div className="my-5 flex items-center justify-between px-6">
        <Button
          variant="link"
          className="flex items-center gap-x-2 text-gray-500"
          onClick={handleAddInvite}
        >
          <Plus className="w-4" /> Add another
        </Button>
      </div>
      <div className="flex w-full justify-end rounded-b-lg border-t bg-gray-50 px-6 py-3">
        <Button disabled={loading} onClick={handleSendInvites}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading ? "Sending invites" : "Send invites"}
        </Button>
      </div>
    </div>
  );
};

const InvitedSection = ({
  team,
  teamInvites,
}: {
  team: Team;
  teamInvites: Invite[];
}) => {
  const { supabase } = useSupabase();
  const router = useRouter();

  const handleDeleteInvite = useCallback(
    async (invite: Invite) => {
      if (!confirm("Are you sure you want to delete this invite?")) return;

      const { error } = await supabase
        .from("invites")
        .delete()
        .eq("id", invite.id);

      if (error) {
        console.error("Error deleting invite:", error);
        return;
      }

      toast.success(`Invite to ${invite.email} deleted`);

      router.refresh();
    },
    [supabase, router],
  );

  if (!team || !teamInvites) return null;

  return (
    <div className="flex w-full flex-col">
      {teamInvites?.length === 0 && (
        <p className="py-4 text-center text-gray-500">No pending invites</p>
      )}
      {teamInvites?.map((i) => {
        const role = i.role;

        const formattedRole =
          role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();

        return (
          <div
            className="flex justify-between border-b px-6 py-3 last-of-type:border-none"
            key={i.id}
          >
            <div className="flex items-center gap-x-2">
              <div className="flex flex-col gap-y-1">
                <p className="">{i.email}</p>
                <p className="font-medium text-gray-500">{formattedRole}</p>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger>
                <MoreHorizontal className="h-8 w-8 px-2 text-gray-500" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {/* <DropdownMenuItem
                  onClick={async () => {
                    await resendInviteEmailMutation.mutateAsync({
                      teamId: team.id,
                      inviteId: i.id,
                    });
                    toast.success(`Invite resent to ${i.email}`);
                  }}
                >
                  Resend invite
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      getTeamInviteUrl({ code: i.code, email: i.email })
                    );
                  }}
                >
                  Copy invite link
                </DropdownMenuItem> */}
                <DropdownMenuItem
                  className="text-red-500"
                  onClick={async () => {
                    await handleDeleteInvite(i);
                  }}
                >
                  Delete invite
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </div>
  );
};

const MembersSection = ({
  team,
  user,
  userMember,
  teamMembers,
  teamMembersProfiles,
}: {
  team: Team;
  user: Profile;
  userMember: Member;
  teamMembers: Member[];
  teamMembersProfiles: Profile[];
}) => {
  const [loading, setLoading] = useState(false);

  const handleUpdateRole = useCallback(
    async (member: Member, role: Role) => {
      if (!team) return;

      if (member.user_id === user.id) {
        toast.error("You can't change your own role", {
          description: "Ask another admin to change your role",
        });
        return;
      }

      setLoading(true);

      toast.success(`Role has been updated to ${role}`);

      setLoading(false);
    },
    [team, user],
  );

  const handleRemoveMember = useCallback(
    async (member: Member) => {
      if (!team) return;

      if (member.user_id === user?.id) {
        toast.error("You can't remove yourself", {
          description: "Leave the team instead",
        });
        return;
      }

      if (!confirm("Are you sure you want to remove this member?")) return;

      toast.success("Member removed from team the team");
    },
    [team, user],
  );

  if (!user || !team || !teamMembers || !teamMembersProfiles) return null;

  const isAdmin = userMember.role === ROLE_ADMIN;

  return (
    <>
      {teamMembers.map((m) => {
        const role = m.role;
        const profile = teamMembersProfiles.find((p) => p.id === m.user_id);
        return (
          <div
            className="flex justify-between border-b border-gray-100 px-4 py-3 last-of-type:border-none"
            key={m.id}
          >
            <div className="flex items-center gap-x-2">
              <Avatar>
                <AvatarFallback>
                  {(profile?.full_name ?? profile?.email ?? "")[0]}
                </AvatarFallback>
                <AvatarImage src={undefined} />
              </Avatar>
              <div className="flex flex-col">
                <p className="font-medium">
                  {profile?.full_name ?? profile?.email ?? "Unknown"}
                </p>
                <p className="text-gray-500">{profile?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-x-6">
              <div className="">
                {user.id === m.user_id || !isAdmin ? (
                  <span className="text-gray-500">
                    {role[0].toUpperCase() + role.slice(1).toLowerCase()}
                  </span>
                ) : (
                  <Select
                    onValueChange={(v) => handleUpdateRole(m, v as Role)}
                    defaultValue={role}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => {
                        return (
                          <SelectItem value={r} key={r}>
                            {
                              // convert to title case
                              r[0].toUpperCase() + r.slice(1).toLowerCase()
                            }
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {user.id !== m.user_id && (
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <MoreHorizontal className="w-4 text-gray-500" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={async () => {
                        await handleRemoveMember(m);
                      }}
                      className="text-red-500"
                    >
                      Remove user
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
};

export default function MembersComponent({
  team,
  user,
  userMember,
  teamMembers,
  teamInvites,
  teamMembersProfiles,
}: {
  team: Team;
  user: Profile;
  userMember: Member;
  teamMembers: Member[];
  teamInvites: Invite[];
  teamMembersProfiles: Profile[];
}) {
  return (
    <div className="flex flex-col gap-y-8">
      <InviteSection team={team} user={user} />
      <div className="flex flex-col rounded-lg border bg-white">
        <h3 className="ml-6 mt-4 text-lg font-medium">Members</h3>
        <Tabs defaultValue="members" className="pb-2">
          <TabsList className="mb-1 ml-4 mt-3">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="invited">Invited</TabsTrigger>
          </TabsList>
          <TabsContent value="members">
            <MembersSection
              team={team}
              user={user}
              userMember={userMember}
              teamMembers={teamMembers}
              teamMembersProfiles={teamMembersProfiles}
            />
          </TabsContent>
          <TabsContent value="invited">
            <InvitedSection team={team} teamInvites={teamInvites} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
