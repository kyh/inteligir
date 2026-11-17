import { connection } from "next/server";

import { APP_URL } from "#lib/app-url";
import { llmsTxt } from "#lib/site-content";

// at request time, so the connector it names is the answering deployment's, not the build's
export const GET = async () => {
  await connection();
  return new Response(llmsTxt(APP_URL), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
};
