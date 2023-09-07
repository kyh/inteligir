import Image from "next/image";
import { DISCORD_LINK } from "~/lib/links";
import Link from "next/link";

import discordLogo from "~/public/logos/discord.png";

export default function JoinDiscordButton() {
  return (
    <Link
      href={DISCORD_LINK}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-10 items-center space-x-2 self-start rounded-md bg-indigo-100 py-2 px-4 font-medium text-indigo-900 transition hover:bg-indigo-200"
    >
      <Image src={discordLogo} alt="discord logo" width={16} height={16} />
      <p>Join our Discord</p>
    </Link>
  );
}
