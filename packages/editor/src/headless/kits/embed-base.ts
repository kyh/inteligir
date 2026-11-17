// An embed saves as `![](url)`, so its url is all of it that reaches the file.

import { BaseFilePlugin, BaseMediaEmbedPlugin, BaseVideoPlugin } from "@platejs/media";

export const EmbedBaseKit = [BaseVideoPlugin, BaseMediaEmbedPlugin, BaseFilePlugin];
