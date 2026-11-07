import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [viteReact(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  // beside dev:web's 5174, so both run at once; strictPort for the same reason that one pins.
  server: { port: 5175, strictPort: true },
});
