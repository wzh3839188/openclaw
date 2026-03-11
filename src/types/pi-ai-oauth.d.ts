/**
 * Type declarations for @mariozechner/pi-ai/oauth when the subpath is not
 * exported by the installed package (e.g. older or different pi-ai version).
 * Remove this file when pi-ai exposes the oauth module.
 */
declare module "@mariozechner/pi-ai/oauth" {
  import type { OAuthCredentials, OAuthProvider } from "@mariozechner/pi-ai";
  export function getOAuthApiKey(
    provider: OAuthProvider,
    creds: OAuthCredentials | Record<string, OAuthCredentials>,
  ): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null>;
  export function getOAuthProviders(): Array<{ id: string }>;
  export function loginOpenAICodex(params: {
    onAuth: (event: { url: string }) => Promise<void>;
    onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
    onProgress?: (message: string) => void;
  }): Promise<OAuthCredentials | null>;
}
