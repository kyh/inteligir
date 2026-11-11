import { toast } from "@repo/ui/components/sonner";

export const copyText = async (text: string, done = "Copied"): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast.error("Could not copy");
    return;
  }
  toast.success(done);
};
