import { shell } from "electron";
import { loginOpenAICodex, refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export type { OAuthCredentials };

/**
 * Starts the OpenAI Codex OAuth login flow via pi-ai.
 * Opens the user's browser for authentication and waits for the callback.
 */
export function login(): Promise<OAuthCredentials> {
  return loginOpenAICodex({
    onAuth: (info) => {
      void shell.openExternal(info.url);
    },
    onPrompt: () => {
      // The PKCE flow shouldn't need interactive prompts in our case.
      // If it does, reject to fall back to browser-only flow.
      return Promise.reject(new Error("Interactive prompt not supported"));
    },
    originator: "inteligir",
  });
}

export { refreshOpenAICodexToken as refreshToken };
