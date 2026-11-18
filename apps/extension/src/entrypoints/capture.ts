import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

import { serializePage } from "../capture/serialize-page";

export default defineUnlistedScript({ main: () => serializePage(document) });
