import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [viteReact({ compiler: true }), tailwindcss()],
  // beside dev:web's 5174, so both run at once; strictPort for the same reason that one pins.
  server: { port: 5175, strictPort: true },
});
