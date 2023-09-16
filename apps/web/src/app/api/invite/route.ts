import InviteEmail from "emails/invite";
import { resend } from "@/lib/resend";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const res = await request.json();

  const { record } = res;

  const { id, email, send } = record;

  const baseUrl = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";

  // send email to user with link to /invite/[id]

  if (send) {
    try {
      await resend.emails.send({
        from: "Inteligir <team@mail.inteligir.com>",
        to: [email],
        subject: "Your invitation to Inteligir",
        react: InviteEmail({
          toEmail: email,
          inviteUrl: `${baseUrl}/invitation/${id}`,
        }),
      });
    } catch (error) {
      return new Response((error as Error).message, {
        status: 500,
      });
    }
  }

  return new Response("Success", {
    status: 200,
  });
}
