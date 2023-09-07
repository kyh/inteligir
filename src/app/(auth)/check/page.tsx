import IconCircle from "~/app/(protected)/components/IconCircle";
import { Button } from "~/components/ui/button";
import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";

export default async function CheckPage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="flex flex-col items-center space-y-6 ">
        <IconCircle>
          <Mail className="h-6 w-6 text-gray-600" />
        </IconCircle>
        <h1 className="text-3xl font-semibold">Check your email</h1>
        <p className="text-center text-lg">
          <span className="text-gray-500">
            We emailed a sign-in link to you.
          </span>
        </p>
        <Link href={"/signin"}>
          <Button variant="link">
            <ArrowLeft className="mr-2 w-4" />
            <span>Back to sign in</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
