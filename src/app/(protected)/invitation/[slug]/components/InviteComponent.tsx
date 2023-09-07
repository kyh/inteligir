"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { useSupabase } from "~/components/providers/supabase-provider";
import { DoorOpenIcon, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "~/components/ui/button";

export function InviteComponent({
  team,
  user,
  invite,
}: {
  team: Team;
  user: Profile;
  invite: Invite;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const { supabase } = useSupabase();

  if (!user) return null;

  const handleJoin = async () => {
    setLoading(true);
    const { error } = await supabase
      .from("members")
      .insert([{ team_id: team.id, user_id: user.id, role: invite.role }]);
    if (error) {
      console.error(error);
      setLoading(false);
    } else {
      router.push(`/${team.id}`);
    }
  };

  return (
    <div className="flex h-full justify-center items-center">
      <div className="flex flex-col items-center space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">Suparepo Invitation</CardTitle>
            <CardDescription className="text-center">
              Join {team.name} on Suparepo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="justify-center flex">
              <Button className="p-6" onClick={handleJoin}>
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <DoorOpenIcon size={24} />
                )}

                <span className="ml-2 text-lg">Join</span>
              </Button>
            </div>
          </CardContent>
          <CardFooter className="text-center max-w-md">
            By joining, you will be able to access the team&apos;s projects and
            collaborate with other members.
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
