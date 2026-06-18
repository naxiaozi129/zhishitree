import { GoogleGenAI } from '@google/genai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

function geminiProxyUrl(): string | undefined {
  const v =
    process.env.GEMINI_HTTP_PROXY?.trim() ||
    process.env.GEMINI_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim();
  return v || undefined;
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  const httpOptions: { baseUrl?: string } = {};
  const baseUrl = process.env.GOOGLE_GEMINI_BASE_URL?.trim() || process.env.GEMINI_BASE_URL?.trim();
  if (baseUrl) httpOptions.baseUrl = baseUrl;
  return new GoogleGenAI({
    apiKey,
    httpOptions: Object.keys(httpOptions).length ? httpOptions : undefined,
  });
}

/** 仅 Gemini 请求走代理，不影响智谱等其它 fetch */
export async function runWithGeminiNetwork<T>(fn: () => Promise<T>): Promise<T> {
  const proxy = geminiProxyUrl();
  if (!proxy) return fn();

  const orig = globalThis.fetch;
  const dispatcher = new ProxyAgent(proxy);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...init,
      dispatcher,
    } as Parameters<typeof undiciFetch>[1])) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

export function geminiNetworkHint(): string {
  const proxy = geminiProxyUrl();
  if (proxy) return `已配置代理 ${proxy}`;
  return '未配置 GEMINI_HTTP_PROXY；国内服务器通常需代理才能访问 Google API';
}
