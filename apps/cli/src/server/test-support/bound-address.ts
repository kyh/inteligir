// `net.Server#address()` answers a pipe name, an AddressInfo or null; a bound TCP port wants only the second.

import { z } from "zod";

export const boundAddressSchema = z.object({ port: z.number() });
