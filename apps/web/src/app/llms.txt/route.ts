import { APP_URL } from "@repo/service/app-url";
import { connection } from "next/server";

import { llmsTxt } from "#lib/site-content";

export const GET = async () => {
  await connection();

  return new Response(llmsTxt(APP_URL), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
};
