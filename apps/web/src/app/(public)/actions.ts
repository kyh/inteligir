"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const joinWaitlist = async (formData: FormData) => {
  await sleep(1000);
  const email = formData.get("email")?.toString();

  cookies().set("registered_waitlist", email || "");
  revalidatePath("/");
};
