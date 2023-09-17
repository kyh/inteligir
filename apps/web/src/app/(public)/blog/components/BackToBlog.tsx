import { Button } from "ui/components/button";
import { ArrowLeft } from "ui/icons";
import Link from "next/link";

export default function BackToBlog() {
  return (
    <Link href="/blog">
      <Button variant="link" className="px-0 text-gray-600 hover:underline">
        <ArrowLeft className="mr-2 w-4" /> Back to blog
      </Button>
    </Link>
  );
}
