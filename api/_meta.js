const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function requireToken() {
  const token = process.env.META_USER_ACCESS_TOKEN;
  if (!token) {
    const error = new Error('META_USER_ACCESS_TOKEN is not configured on the server.');
    error.statusCode = 500;
    throw error;
  }
  return token;
}

export async function graph(path, token, params = {}) {
  const cleanPath = String(path || '').replace(/^\//, '');
  const url = new URL(`${GRAPH_BASE}/${cleanPath}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('access_token', token);

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    const metaError = json.error || {};
    const error = new Error(metaError.message || `Meta API request failed (${response.status})`);
    error.statusCode = response.status || 500;
    error.meta = metaError;
    throw error;
  }
  return json;
}

export async function pMapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      try {
        results[current] = await mapper(items[current], current);
      } catch (error) {
        results[current] = { __error: true, message: error.message };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}

export function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(payload));
}

export function metricValue(data, name) {
  const metric = Array.isArray(data) ? data.find((item) => item?.name === name) : null;
  const value = metric?.values?.[0]?.value;
  return typeof value === 'number' ? value : 0;
}

export function safeInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
