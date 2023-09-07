"use client";
import IconCircle from "./IconCircle";
import { Button } from "~/components/ui/button";
import { useSupabase } from "~/components/providers/supabase-provider";

import { ArrowRight, Home } from "lucide-react";
import Link from "next/link";

const HomeCard = () => {
  const { supabase } = useSupabase();
  return (
    <div className="flex h-full w-full justify-center md:items-center">
      <div className="flex flex-col items-center space-y-8 p-8 text-center">
        <IconCircle>
          <Home />
        </IconCircle>
        <div className="flex flex-col items-center space-y-2">
          <h1 className="text-xl font-medium">
            Welcome! Let&apos;s get started.
          </h1>
          <p className="w-3/4 text-gray-600">
            Explore the app from the sidebar or learn about all of the features
            in the docs.
          </p>
        </div>
        <Link href={"/"} rel="noopener noreferrer">
          <Button>
            <ArrowRight className="mr-2 w-4" /> Go Home
          </Button>
        </Link>
        <Button
          variant="link"
          onClick={async () => {
            await supabase.auth.signOut();
          }}
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
};

export default HomeCard;
