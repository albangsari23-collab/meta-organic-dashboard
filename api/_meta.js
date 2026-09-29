const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function getUserToken() {
  return process.env.META_USER_ACCESS_TOKEN || '';
}

export function getSystemUserToken() {
  return process.env.META_SYSTEM_USER_ACCESS_TOKEN || '';
}

export function getPrimaryToken() {
  return getSystemUserToken() || getUserToken();
}

export function requireToken() {
  const token = getPrimaryToken();
  if (!token) {
    const error = new Error(
      'No Meta credential is configured. Add META_SYSTEM_USER_ACCESS_TOKEN, META_PAGE_TOKENS_JSON, or META_USER_ACCESS_TOKEN.'
    );
    error.statusCode = 500;
    throw error;
  }
  return token;
}

function normalizeConfiguredPage(raw = {}, fallbackId = '') {
  const pageId = String(raw.pageId || raw.id || fallbackId || '').trim();
  const accessToken = String(
    raw.pageAccessToken || raw.access_token || raw.accessToken || raw.token || ''
  ).trim();
  if (!pageId || !accessToken) return null;

  const igId = raw.instagramBusinessAccountId
    || raw.instagram_business_account?.id
    || raw.instagram_business_account_id
    || null;

  return {
    id: pageId,
    name: raw.pageName || raw.name || `Page ${pageId}`,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    access_token: accessToken,
    instagram_business_account: igId ? { id: String(igId) } : null,
    auth_mode: 'page_access_token'
  };
}

export function getConfiguredPages() {
  const pages = [];
  const json = process.env.META_PAGE_TOKENS_JSON;

  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const page = normalizeConfiguredPage(item);
          if (page) pages.push(page);
        }
      } else if (parsed && typeof parsed === 'object') {
        for (const [pageId, value] of Object.entries(parsed)) {
          const page = typeof value === 'string'
            ? normalizeConfiguredPage({ pageId, pageAccessToken: value })
            : normalizeConfiguredPage(value || {}, pageId);
          if (page) pages.push(page);
        }
      }
    } catch (error) {
      const configError = new Error('META_PAGE_TOKENS_JSON is not valid JSON.');
      configError.statusCode = 500;
      throw configError;
    }
  }

  const singleToken = process.env.META_PAGE_ACCESS_TOKEN;
  const singleId = process.env.META_PAGE_ID;
  if (singleToken && singleId) {
    const page = normalizeConfiguredPage({
      pageId: singleId,
      pageName: process.env.META_PAGE_NAME || undefined,
      pageAccessToken: singleToken,
      instagramBusinessAccountId: process.env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID || undefined
    });
    if (page) pages.push(page);
  }

  const seen = new Set();
  return pages.filter((page) => {
    if (seen.has(page.id)) return false;
    seen.add(page.id);
    return true;
  });
}

export function getConfiguredPage(pageId) {
  return getConfiguredPages().find((page) => String(page.id) === String(pageId)) || null;
}

export function getBusinessId() {
  return process.env.META_BUSINESS_ID || '';
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
