"use client";

import { useSupabase } from "@/components/providers/supabase-provider";
import { Home } from "ui/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Logo from "ui/components/logo";
import Step, { StepProps } from "./Steps";
import Testimonial from "./Testimonial";

export default function CreateWorkspace({ user }: { user: Profile }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { supabase } = useSupabase();

  const CREATE_TEAM_STEP: Omit<StepProps, "loading"> = {
    title: "What do you want to name your workspace?",
    icon: <Home className="h-6 w-6 text-gray-600" />,
    fieldType: "text",
    placeholder: "ex: Personal or Acme Corp",
    onSubmit: async (value: string) => {
      if (!value || !user) return;

      setLoading(true);

      const { data: teams, error } = await supabase
        .from("teams")
        .insert({ name: value })
        .select();

      if (error || !teams) {
        console.error("Error creating team:", error);
        return;
      }

      const team = teams[0]; // Newly created team instance

      if (!team) {
        console.error("No team data received");
        return;
      }

      const { data: memberData, error: memberError } = await supabase
        .from("members")
        .insert({
          user_id: user.id,
          team_id: team.id,
          role: "ADMIN",
        })
        .select();

      if (memberError || !memberData) {
        console.error("Error adding member:", memberError);
        return;
      }

      router.push(`/${team.id}`);
    },
  };

  if (!user) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-auto overflow-y-auto">
        <div className="flex flex-1 flex-col overflow-y-auto px-8 lg:px-16">
          <div className="mt-8">
            <Logo variant="wordmark" />
          </div>
          <div className="my-auto">
            <div className="mb-32">
              <Step {...CREATE_TEAM_STEP} loading={loading} />
            </div>
          </div>
        </div>
        <div className="hidden flex-1 items-center justify-center border-l bg-gray-50 lg:flex">
          <div className="mx-8">
            <Testimonial />
          </div>
        </div>
      </div>
    </div>
  );
}
