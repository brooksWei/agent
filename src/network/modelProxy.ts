import { ProxyAgent, setGlobalDispatcher } from "undici";

import type { AgentEnv } from "../config/env";

export type ModelProxyStatus = {
  enabled: boolean;
  proxyUrl?: string;
  message: string;
};

let appliedProxyUrl: string | undefined;

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function setupModelProxy(env: AgentEnv): ModelProxyStatus {
  if (!env.modelProxyEnabled) {
    return {
      enabled: false,
      message: "MODEL_PROXY_ENABLED=false",
    };
  }

  if (!env.modelProxyUrl) {
    return {
      enabled: false,
      message: "MODEL_PROXY_URL is empty",
    };
  }

  if (!isValidUrl(env.modelProxyUrl)) {
    return {
      enabled: false,
      message: `MODEL_PROXY_URL is invalid: ${env.modelProxyUrl}`,
    };
  }

  if (appliedProxyUrl === env.modelProxyUrl) {
    return {
      enabled: true,
      proxyUrl: env.modelProxyUrl,
      message: "already configured",
    };
  }

  const proxyAgent = new ProxyAgent(env.modelProxyUrl);
  setGlobalDispatcher(proxyAgent);

  // Keep env vars in sync for SDKs that rely on HTTP(S)_PROXY.
  process.env.HTTP_PROXY = env.modelProxyUrl;
  process.env.HTTPS_PROXY = env.modelProxyUrl;

  appliedProxyUrl = env.modelProxyUrl;
  return {
    enabled: true,
    proxyUrl: env.modelProxyUrl,
    message: "configured",
  };
}
