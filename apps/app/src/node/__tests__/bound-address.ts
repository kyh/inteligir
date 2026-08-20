// `net.Server#address()` answers a pipe name, an AddressInfo, or null — a
// suite that bound a TCP port wants the third case and nothing else, so the
// union is parsed once here rather than narrowed at every call site.

import { z } from "zod";

export const boundAddressSchema = z.object({ port: z.number() });
