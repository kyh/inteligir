import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Optional native modules pulled in transitively by the Discord adapter's
// Gateway client (@discordjs/ws). They can't be bundled for / run on Cloudflare
// Workers, and the Gateway path is unsupported there anyway, so alias them to an
// empty stub. Slack/Telegram/WhatsApp (plain webhooks) are unaffected.
const nativeStub = fileURLToPath(new URL("./src/server/chat/native-stub.js", import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      { find: /^zlib-sync$/, replacement: nativeStub },
      { find: /^bufferutil$/, replacement: nativeStub },
      { find: /^utf-8-validate$/, replacement: nativeStub },
    ],
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
