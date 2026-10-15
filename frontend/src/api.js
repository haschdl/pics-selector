async function fetchJson(url, errorMessage) {
  let lastError = new Error(errorMessage);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      lastError = new Error(errorMessage);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(errorMessage);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError;
}

export async function getCatalog() {
  return fetchJson("/api/catalog", "Could not read the pics folder");
}

export async function getSession() {
  return fetchJson("/api/session", "Could not load saved progress");
}

export async function saveSession(session) {
  const res = await fetch("/api/session", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
  if (!res.ok) throw new Error("Could not save progress");
  return res.json();
}

export function thumbUrl(name) {
  return `/media/image/thumbs/${encodeURIComponent(name)}`;
}

export function largeUrl(name) {
  return `/media/image/large/${encodeURIComponent(name)}`;
}

export function originalUrl(name) {
  return `/media/image/originals/${encodeURIComponent(name)}`;
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
