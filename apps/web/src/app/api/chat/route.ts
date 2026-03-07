import type { UIMessage } from "ai";
import { convertToModelMessages, smoothStream, streamText } from "ai";

import { caller } from "@/trpc/server";

export const maxDuration = 30;

export async function POST(request: Request) {
  const { messages, organizationSlug } = (await request.json()) as {
    messages: UIMessage[];
    organizationSlug?: string;
  };

  // Ensure the organization exists and the user has access to it if provided
  if (organizationSlug) {
    await caller.organization.get({ slug: organizationSlug });
  }

  const result = streamText({
    model: "gpt-4o-mini",
    messages: convertToModelMessages(messages),
    experimental_transform: smoothStream({ chunking: "word" }),
  });

  return result.toUIMessageStreamResponse();
}
