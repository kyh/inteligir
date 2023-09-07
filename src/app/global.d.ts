import type { Database } from "~/lib/types";

declare global {
  type Team = Database["public"]["Tables"]["teams"]["Row"];
  type Member = Database["public"]["Tables"]["members"]["Row"];
  type Profile = Database["public"]["Tables"]["profiles"]["Row"];
  type Invite = Database["public"]["Tables"]["invites"]["Row"];
}
