import { z } from "zod";

import { attachmentLocationSchema } from "@repo/api/local/vault/vault-schema";
import { JsonFileStore } from "../json-file-store";

const vaultPrefsSchema = z.object({ attachments: attachmentLocationSchema.optional() }).strict();

// read per paste, so a Settings or CLI change reaches the next paste without a reboot
export class VaultPrefsStore extends JsonFileStore<typeof vaultPrefsSchema> {
  constructor(dataDir: string) {
    super({ dataDir, fileName: "vault-prefs.json", schema: vaultPrefsSchema, empty: {} });
  }
}
