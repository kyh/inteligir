import { ArrowLeft } from "lucide-react";
import { Button } from "~/components/ui/button";
import Link from "next/link";

export default function BackTo({ location }: { location: string }) {
  return (
    <Button asChild variant="link" className="px-0 text-gray-600">
      <Link href={`/${location}`}>
        <ArrowLeft className="mr-2 w-4" /> Back to {location}
      </Link>
    </Button>
  );
}
