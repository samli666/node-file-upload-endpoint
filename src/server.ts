import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { infrai } from "./infrai.ts";

const BUCKET = process.env.UPLOAD_BUCKET ?? "uploads";
const PORT = Number(process.env.PORT ?? 3000);
// The request body is held in memory while it is base64-encoded, so the cap is deliberate.
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024);

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BYTES) throw new Error(`upload exceeds MAX_UPLOAD_BYTES (${MAX_BYTES})`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!url.pathname.startsWith("/files")) {
    json(res, 404, { error: "routes live under /files" });
    return;
  }
  // Everything after /files/ is the object key, slashes included: /files/photos/cat.png
  const key = decodeURIComponent(url.pathname.replace(/^\/files\/?/, ""));

  if (req.method === "PUT" && key) {
    const bytes = await readBody(req);
    const stored = await infrai.storage.object.put(BUCKET, key, {
      data_base64: bytes.toString("base64"),
      content_type: req.headers["content-type"] ?? "application/octet-stream",
    });
    json(res, 201, { key: stored.key ?? key, bytes: bytes.length });
    return;
  }

  if (req.method === "GET" && key) {
    // Read path never proxies bytes: the caller follows a signed URL to storage.
    const signed = await infrai.storage.object.presign(BUCKET, key, {
      op: "get",
      expires_seconds: 300,
    });
    res.writeHead(302, { Location: signed.url });
    res.end();
    return;
  }

  if (req.method === "GET") {
    json(res, 200, await infrai.storage.object.list(BUCKET));
    return;
  }

  if (req.method === "DELETE" && key) {
    await infrai.storage.object.delete(BUCKET, key);
    json(res, 200, { deleted: key });
    return;
  }

  json(res, 405, { error: `${req.method} /files is not handled` });
}

// One bucket call at boot rather than on every upload. In a real deployment this
// belongs in a setup script; it is inline here so the demo runs from a bare key.
async function ensureBucket(): Promise<void> {
  try {
    await infrai.storage.bucket.create({ name: BUCKET, acl: "private" });
    console.log(`bucket created: ${BUCKET}`);
  } catch (err) {
    console.log(`reusing bucket ${BUCKET} (${(err as Error).message})`);
  }
}

async function main(): Promise<void> {
  await ensureBucket();
  createServer((req, res) => {
    handle(req, res).catch((err: Error) => {
      console.error(`${req.method} ${req.url} -> ${err.message}`);
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    });
  }).listen(PORT, () => console.log(`upload endpoint on http://localhost:${PORT}/files`));
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
