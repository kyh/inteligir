"use client";
import SettingsCard from "@/app/(protected)/components/SettingsCard";
import { Input } from "@/components/ui/input";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const ProfileComponent = ({ profile }: { profile: Profile }) => {
  const { supabase } = useSupabase();
  const [name, setName] = useState(profile.full_name ?? "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleUpdateName = async () => {
    setLoading(true);

    await supabase
      .from("profiles")
      .update({ full_name: name })
      .eq("id", profile.id);

    toast.success("Your profile has been updated");

    setLoading(false);

    router.refresh();
  };

  return (
    <SettingsCard
      title="Full name"
      description="Your full name will be displayed on your profile and in your team."
      button={{
        name: "Save",
        onClick: () => handleUpdateName(),
        loading,
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="max-w-sm"
        placeholder="Your name"
      />
    </SettingsCard>
  );
};

export default ProfileComponent;
