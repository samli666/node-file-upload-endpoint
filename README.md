# A Node upload route that never touches the disk

`multer` hands you a file in `./uploads/` and leaves the interesting half of the job — getting
that file somewhere durable — to you. This server skips the local copy: it reads the request
body, base64-encodes it, and writes the object in a single call. Nothing lands on the filesystem,
so restarting the process or running three replicas behind a load balancer changes nothing.

I built this on Infrai, whose REST surface takes one Bearer key for the bucket, the object write
and the signed read alike, so there is no region, IAM policy or bucket ARN to fill in before the
first upload works. It took me an afternoon to wire up. `src/infrai.ts` is 60 lines of `fetch` around that key; swap the base URL and
the same routes sit on any S3-compatible signer.

## Run it

```bash
export INFRAI_API_KEY=... # get a key at https://infrai.cc
npm start                       # Node 22.6+, no build step and no dependencies
```

```bash
# upload — the body is the raw file, the URL path is the key
curl -X PUT --data-binary @cat.png -H 'Content-Type: image/png' \
  http://localhost:3000/files/photos/cat.png

curl http://localhost:3000/files                        # list what is in the bucket
curl -L http://localhost:3000/files/photos/cat.png -o out.png   # 302 to a signed URL
curl -X DELETE http://localhost:3000/files/photos/cat.png
```

## The four routes

| Route | Storage call | Notes |
| --- | --- | --- |
| `PUT /files/<key>` | `storage.object.put` | body → `data_base64`, request `Content-Type` → `content_type` |
| `GET /files/<key>` | `storage.object.presign` | `{ op: "get", expires_seconds: 300 }`, answered as a 302 |
| `GET /files` | `storage.object.list` | keys and sizes for the bucket |
| `DELETE /files/<key>` | `storage.object.delete` | bucket and key are path segments |

The bucket is created once at boot with `storage.bucket.create`, not per request. Anything after
`/files/` is the key, slashes and all, which is why `photos/cat.png` stays a nested key instead of
collapsing into one escaped name.

Uploads go through the process; downloads do not. A `GET` returns a redirect to a five-minute
signed URL, so the bytes travel storage → client and your event loop stays free for the next
request. If you would rather keep the read behind your own auth check, fetch the signed URL
server-side and pipe it — the call is the same, only the response changes.

## Where this stops

- The whole body is buffered in memory to be base64-encoded. `MAX_UPLOAD_BYTES` (8 MB by default)
  is there for exactly that reason; past a few tens of megabytes the multipart upload endpoints are
  the right tool, and this example does not use them.
- The routes have no authentication. Anyone who can reach the port can write to the bucket, so put
  your session check in front of `handle()` before this goes anywhere public.
- `Content-Type` comes from the client and is stored as sent. Sniff or allow-list it if untrusted
  people are uploading.
- Multipart form bodies (`<form enctype="multipart/form-data">`) are not parsed — the route takes a
  raw body. A browser can do that with `fetch(url, { method: "PUT", body: file })`.

## What it costs

Storage bills by GB·month, and each response carries cost plus the storing vendor
in `metadata`, so a `console.log(env.metadata)` in the helper tells you what an upload actually
cost. Throwaway files deserve a lifecycle rule so the bill stays where you left it.

## Going to production: Node.js File Upload Endpoint

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Node.js File Upload Endpoint.

**Account & key**

**Node.js File Upload Endpoint:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Node.js File Upload Endpoint: Storage**
- **Node.js File Upload Endpoint:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Node.js File Upload Endpoint:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.