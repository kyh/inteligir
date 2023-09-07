import { Twitter } from "lucide-react";
import { Button } from "~/components/ui/button";

export default function TwitterFollowButton() {
  return (
    <Button asChild className="self-start">
      <a
        target="blank"
        rel="noopener noreferrer"
        href="https://twitter.com/neorepo"
      >
        <Twitter className="mr-2 w-4 shrink-0" />
        Follow us on Twitter
      </a>
    </Button>
  );
}
