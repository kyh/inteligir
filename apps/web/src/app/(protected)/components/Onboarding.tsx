"use client";

import { useSupabase } from "@/components/providers/supabase-provider";
import { User as UserIcon } from "ui/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Logo from "ui/components/logo";
import Step, { StepProps } from "./Steps";
import Testimonial from "./Testimonial";

export default function Onboarding({ user }: { user: Profile }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { supabase } = useSupabase();

  const NAME_STEP: Omit<StepProps, "loading"> = {
    title: "How should we greet you?",
    icon: <UserIcon className="h-6 w-6 text-gray-600" />,
    fieldType: "text",
    placeholder: "Jane Doe",
    onSubmit: async (value: string) => {
      if (!user) return;

      setLoading(true);

      // update user profile in supabase profiles table
      await supabase
        .from("profiles")
        .update({
          full_name: value,
          has_onboarded: true,
        })
        .eq("id", user.id);

      router.push(`/start`);

      setLoading(false);
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
              <Step {...NAME_STEP} loading={loading} />
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
