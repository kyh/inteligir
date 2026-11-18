import { webSearch } from "eve/tools/web_search";

// the model's own search, with no fallback: the gateway is pinned to Anthropic, whose search it is
export default webSearch({ provider: "native" });
