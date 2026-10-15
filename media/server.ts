import { issueSignedToken, presignUrl, put } from "@vercel/blob";
import { GoogleAuth } from "google-auth-library";
import sharp from "sharp";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const NAME_RE = /^IMG_(\d+)\.jpg$/i;
const VARIANTS = new Set(["thumbs", "large", "originals"]);
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_TTL_MS = 55 * 60 * 1000;
const URL_TTL_MS = 10 * 60 * 1000;
const MAX_IMPORT_BATCH = 20;
const IMPORT_HEADER = "drive-to-blob-v1";

let signingTokenCache: { value: Awaited<ReturnType<typeof issueSignedToken>>; expiresAt: number } | null = null;
let driveListCache: { value: DriveFile[]; expiresAt: number } | null = null;

type DriveFile = {
  id: string;
  name: string;
  size?: string;
  imageMediaMetadata?: { width?: number; height?: number };
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function privateKey(): string {
  return env("GOOGLE_PRIVATE_KEY").replaceAll("\\n", "\n");
}

function googleAuth() {
  return new GoogleAuth({
    credentials: {
      client_email: env("GOOGLE_CLIENT_EMAIL"),
      private_key: privateKey(),
    },
    scopes: [DRIVE_SCOPE],
  });
}

async function googleAccessToken(): Promise<string> {
  const client = await googleAuth().getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Could not obtain Google access token");
  return token.token;
}

async function listDrivePhotos(): Promise<DriveFile[]> {
  if (driveListCache && driveListCache.expiresAt > Date.now()) return driveListCache.value;

  const folderId = env("GOOGLE_DRIVE_FOLDER_ID");
  const token = await googleAccessToken();
  const photos: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType = 'image/jpeg'`,
      fields: "nextPageToken,files(id,name,size,imageMediaMetadata(width,height))",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) query.set("pageToken", pageToken);

    const response = await fetch(`${DRIVE_API}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Drive list failed: ${response.status}`);

    const payload = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
    photos.push(...(payload.files ?? []).filter((item) => NAME_RE.test(item.name)));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  photos.sort((a, b) => Number(a.name.match(NAME_RE)?.[1] ?? 0) - Number(b.name.match(NAME_RE)?.[1] ?? 0));
  driveListCache = { value: photos, expiresAt: Date.now() + 5 * 60 * 1000 };
  return photos;
}

async function downloadDrivePhoto(file: DriveFile): Promise<Buffer> {
  const token = await googleAccessToken();
  const response = await fetch(`${DRIVE_API}/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Drive download failed for ${file.name}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function jpegVariant(source: Buffer, longEdge: number): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 84 })
    .toBuffer();
}

async function storeJpeg(pathname: string, body: Buffer) {
  return put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/jpeg",
    cacheControlMaxAge: 31_536_000,
  });
}

async function importOne(file: DriveFile) {
  const original = await downloadDrivePhoto(file);
  const [large, thumb] = await Promise.all([
    jpegVariant(original, 1400),
    jpegVariant(original, 480),
  ]);

  await Promise.all([
    storeJpeg(`originals/${file.name}`, original),
    storeJpeg(`large/${file.name}`, large),
    storeJpeg(`thumbs/${file.name}`, thumb),
  ]);

  return {
    name: file.name,
    sourceBytes: original.byteLength,
    largeBytes: large.byteLength,
    thumbBytes: thumb.byteLength,
  };
}

function canImport(request: Request): boolean {
  return request.headers.get("x-keepers-import") === IMPORT_HEADER;
}

async function getSigningToken() {
  if (signingTokenCache && signingTokenCache.expiresAt > Date.now() + 60_000) {
    return signingTokenCache.value;
  }

  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const value = await issueSignedToken({
    operations: ["get"],
    validUntil: expiresAt,
  });
  signingTokenCache = { value, expiresAt };
  return value;
}

async function imageRedirect(variant: string, name: string) {
  if (!VARIANTS.has(variant) || !NAME_RE.test(name)) {
    return new Response("Not found", { status: 404 });
  }

  const pathname = `${variant}/${name}`;
  const token = await getSigningToken();
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    access: "private",
    validUntil: Date.now() + URL_TTL_MS,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: presignedUrl,
      "Cache-Control": "private, max-age=300",
    },
  });
}

async function importBatch(request: Request, url: URL) {
  if (!canImport(request)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const photos = await listDrivePhotos();
  const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "10", 10) || 10;
  const limit = Math.max(1, Math.min(MAX_IMPORT_BATCH, requested));
  const batch = photos.slice(offset, offset + limit);

  const imported: unknown[] = [];
  const failed: { name: string; error: string }[] = [];

  for (let index = 0; index < batch.length; index += 3) {
    const chunk = batch.slice(index, index + 3);
    const results = await Promise.allSettled(chunk.map(importOne));
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") imported.push(result.value);
      else failed.push({
        name: chunk[resultIndex].name,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    });
  }

  const nextOffset = offset + batch.length;
  return Response.json({
    total: photos.length,
    offset,
    processed: batch.length,
    nextOffset,
    done: nextOffset >= photos.length,
    imported,
    failed,
  });
}

Bun.serve({
  async fetch(request) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/media/health") {
        return Response.json({
          ok: true,
          service: "media",
          blobConfigured: Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN),
          driveConfigured: Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY),
        });
      }

      if (request.method === "GET" && url.pathname.startsWith("/media/image/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length !== 4) return new Response("Not found", { status: 404 });
        return imageRedirect(parts[2], decodeURIComponent(parts[3]));
      }

      if (request.method === "POST" && url.pathname === "/media/import") {
        return importBatch(request, url);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Media service error" },
        { status: 500 },
      );
    }
  },
});
