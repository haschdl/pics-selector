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

export async function getSession(user) {
  return fetchJson(
    `/api/session?user=${encodeURIComponent(user)}`,
    `Could not load saved progress for ${user}`,
  );
}

export async function saveSession(user, session) {
  const res = await fetch(`/api/session?user=${encodeURIComponent(user)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
  if (!res.ok) throw new Error(`Could not save progress for ${user}`);
  return res.json();
}

export function thumbUrl(name) {
  return `/api/thumb/${encodeURIComponent(name)}`;
}

export function largeUrl(name) {
  return `/api/large/${encodeURIComponent(name)}`;
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
