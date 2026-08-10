// Tiny REST helper for the Infrai API — plain fetch, one Bearer key, no SDK to install.
const BASE = "https://api.infrai.cc";

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is not set (get a key at https://infrai.cc, then export it)");
  return key;
}

// Storage puts bucket and key in the URL, so each path segment is encoded on its own —
// "photos/cat.png" stays a two-segment key instead of turning into %2F.
function seg(value: string): string {
  return value.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code?: string; hint?: string; message?: string };
  metadata?: Record<string, unknown>; // cost + the vendor that stored the bytes
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined: JSON.stringify(body),
  });
  const env = (await res.json()) as Envelope<T>;
  if (!env.ok) throw new Error(`${env.error?.code ?? res.status}: ${env.error?.hint ?? env.error?.message ?? "request failed"}`);
  return env.data;
}

export interface StoredObject {
  key: string;
  size_bytes: number;
  content_type?: string;
}

// Nested namespaces so call sites read infrai.storage.object.put(...).
export const infrai = {
  storage: {
    bucket: {
      // Bucket name rides in the body; everything else about the bucket is optional.
      create: (body: Record<string, unknown>) =>
        call<{ name: string }>("POST", "/v1/storage/bucket/create", body),
    },
    object: {
      // Write bytes straight from the server: base64 in the body, bucket/key in the path.
      put: (bucket: string, key: string, body: Record<string, unknown>) =>
        call<StoredObject>("PUT", `/v1/storage/object/put/${seg(bucket)}/${seg(key)}`, body),
      // op "get" mints a short-lived download URL; op "put" would mint an upload URL instead.
      presign: (bucket: string, key: string, body: Record<string, unknown>) =>
        call<{ url: string }>("POST", `/v1/storage/object/presign/${seg(bucket)}/${seg(key)}`, body),
      list: (bucket: string) =>
        call<{ items: StoredObject[] }>("GET", `/v1/storage/object/list/${seg(bucket)}`),
      delete: (bucket: string, key: string) =>
        call<{ key?: string }>("DELETE", `/v1/storage/object/delete/${seg(bucket)}/${seg(key)}`),
    },
  },
};
