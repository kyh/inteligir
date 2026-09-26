import { z } from "zod";

import { JsonFileStore } from "../json-file-store";

const cloudPrefsSchema = z.object({ phoneRequests: z.boolean().optional() }).strict();

// read per sync pass, so turning phone requests off stops the next claim without a restart
export class CloudPrefsStore extends JsonFileStore<typeof cloudPrefsSchema> {
  constructor(dataDir: string) {
    super({ dataDir, empty: {}, fileName: "cloud-prefs.json", schema: cloudPrefsSchema });
  }

  // on until the person turns it off: a phone asking its Mac is what signing both in is for
  phoneRequests(): boolean {
    return this.read().phoneRequests ?? true;
  }
}
