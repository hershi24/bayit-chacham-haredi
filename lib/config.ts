import { REQUIRED_SCOPES } from "@/lib/wlte/policy";

export type AppConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  mode: "mock" | "live";
  relayStyle: "indexed" | "batch";
  ivrToken: string;
  ivrTokenIsDefault: boolean;
};

export const DEFAULT_IVR_TOKEN = "dev-ivr-7f3a";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrl = (env.WLTE_BASE_URL || "https://openapi.svnwi.com").replace(/\/$/, "");
  const clientId = env.WLTE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.WLTE_CLIENT_SECRET?.trim() ?? "";
  const requested = env.WLTE_MODE?.trim();
  const mode = requested === "mock" || requested === "live" ? requested : clientId && clientSecret ? "live" : "mock";
  const ivrToken = env.IVR_TOKEN?.trim() || DEFAULT_IVR_TOKEN;
  return {
    baseUrl,
    clientId,
    clientSecret,
    mode,
    relayStyle: env.WLTE_RELAY_STYLE === "batch" ? "batch" : "indexed",
    ivrToken,
    ivrTokenIsDefault: ivrToken === DEFAULT_IVR_TOKEN,
  };
}

export function websocketUrl(baseUrl: string, ticket: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/wlte/v1/ws";
  url.search = "";
  url.searchParams.set("ticket", ticket);
  url.hash = "";
  return url.toString();
}

export { REQUIRED_SCOPES };
