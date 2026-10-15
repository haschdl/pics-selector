import { get, issueSignedToken, presignUrl, put } from "@vercel/blob";
import sharp from "sharp";

const NAME_RE = /^IMG_(\d+)\.jpg$/i;
const VARIANTS = new Set(["thumbs", "large", "originals"]);
const TOKEN_TTL_MS = 55 * 60 * 1000;
const URL_TTL_MS = 10 * 60 * 1000;
const LONG_EDGE: Record<string, number> = {
  thumbs: 480,
  large: 1400,
};

let signingTokenCache: {
  value: Awaited<ReturnType<typeof issueSignedToken>>;
  expiresAt: number;
} | null = null;

const generationInFlight = new Map<string, Promise<void>>();
const knownExisting = new Set<string>();

function blobConfigured() {
  return Boolean(
    process.env.BLOB_STORE_ID ||
      process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.VERCEL_OIDC_TOKEN,
  );
}

async function blobExists(pathname: string): Promise<boolean> {
  if (knownExisting.has(pathname)) return true;

  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return false;

  await result.stream?.cancel();
  knownExisting.add(pathname);
  return true;
}

async function readBlob(pathname: string): Promise<Buffer | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function generateVariant(variant: "thumbs" | "large", name: string) {
  const pathname = `${variant}/${name}`;
  if (await blobExists(pathname)) return;

  const existingJob = generationInFlight.get(pathname);
  if (existingJob) return existingJob;

  const job = (async () => {
    const source = await readBlob(`originals/${name}`);
    if (!source) throw new Error(`Original blob not found: ${name}`);

    const body = await sharp(source)
      .rotate()
      .resize({
        width: LONG_EDGE[variant],
        height: LONG_EDGE[variant],
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84 })
      .toBuffer();

    await put(pathname, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "image/jpeg",
      cacheControlMaxAge: 31_536_000,
    });
    knownExisting.add(pathname);
  })();

  generationInFlight.set(pathname, job);
  try {
    await job;
  } finally {
    generationInFlight.delete(pathname);
  }
}

async function ensureImage(variant: string, name: string): Promise<boolean> {
  if (variant === "originals") return blobExists(`originals/${name}`);
  if (variant !== "thumbs" && variant !== "large") return false;

  try {
    await generateVariant(variant, name);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Original blob not found:")) {
      return false;
    }
    throw error;
  }
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

  if (!(await ensureImage(variant, name))) {
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

Bun.serve({
  async fetch(request) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/media/health") {
        return Response.json({
          ok: true,
          service: "media",
          blobConfigured: blobConfigured(),
          source: "vercel-blob",
          variants: "lazy-cache",
        });
      }

      if (request.method === "GET" && url.pathname.startsWith("/media/image/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length !== 4) return new Response("Not found", { status: 404 });
        return imageRedirect(parts[2], decodeURIComponent(parts[3]));
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
