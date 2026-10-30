function accessToken() {
  return new URLSearchParams(window.location.search).get("token") || "";
}

function withAccessToken(path) {
  const token = accessToken();
  if (!token) throw new Error("Access denied: add the required token to the URL");
  const url = new URL(path, window.location.origin);
  url.searchParams.set("token", token);
  return `${url.pathname}${url.search}`;
}

async function fetchJson(url, errorMessage) {
  let lastError = new Error(errorMessage);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const res = await fetch(withAccessToken(url));
      if (res.ok) return res.json();
      if (res.status === 401) throw new Error("Access denied: invalid token");
      lastError = new Error(errorMessage);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Access denied:")) throw err;
      lastError = err instanceof Error ? err : new Error(errorMessage);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError;
}

export async function getCatalog() {
  return fetchJson("/api/catalog", "Could not read the pics folder");
}

export async function getSession(user) {
  return fetchJson(
    `/api/session?user=${encodeURIComponent(user)}`,
    "Could not load saved progress",
  );
}

export async function saveSession(session, user) {
  const res = await fetch(withAccessToken(`/api/session?user=${encodeURIComponent(user)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
  if (res.status === 401) throw new Error("Access denied: invalid token");
  if (!res.ok) throw new Error("Could not save progress");
  return res.json();
}

export function thumbUrl(name) {
  return withAccessToken(`/media/image/thumbs/${encodeURIComponent(name)}`);
}

export function largeUrl(name) {
  return withAccessToken(`/media/image/large/${encodeURIComponent(name)}`);
}

export function pickedFromDecisions(decisions) {
  const names = [];
  for (const decision of Object.values(decisions || {})) {
    if (decision?.picks?.length) names.push(...decision.picks);
  }
  return names;
}

export function syncKeepers(keepers, picked) {
  const pickedSet = new Set(picked);
  const kept = (keepers || []).filter((name) => pickedSet.has(name));
  const added = picked.filter((name) => !kept.includes(name));
  return [...kept, ...added];
}

export function burstStatus(decision) {
  if (!decision) return "open";
  if (decision.skipped) return "skipped";
  if (decision.picks?.length) return "picked";
  return "open";
}
