/** How requests reach a llama-server: plain HTTP, or the native-messaging bridge. */
export interface Transport {
  post(base: string, path: string, body: unknown, timeoutMs: number): Promise<unknown>;
  /** Throws when the server at `base` is not ready. */
  ready(base: string): Promise<void>;
}

export const httpTransport: Transport = {
  async post(base, path, body, timeoutMs) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${base}${path} answered HTTP ${response.status}`);
    return response.json();
  },
  async ready(base) {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`${base} is not ready (HTTP ${response.status})`);
  },
};
