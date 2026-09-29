import {
  getBusinessId,
  getConfiguredPages,
  getSystemUserToken,
  getUserToken,
  graph,
  send
} from './_meta.js';

async function testConfiguredPages() {
  const configured = getConfiguredPages();
  for (const page of configured) {
    try {
      const result = await graph(page.id, page.access_token, { fields: 'id,name' });
      return {
        ok: true,
        authMode: 'page_access_token',
        identity: { id: result.id, name: result.name },
        configuredPages: configured.length
      };
    } catch (_) {}
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  try {
    const permanentPage = await testConfiguredPages();
    if (permanentPage) {
      return send(res, 200, {
        ok: true,
        authenticated: true,
        ...permanentPage,
        graphVersion: process.env.META_GRAPH_VERSION || 'v26.0'
      });
    }

    const systemToken = getSystemUserToken();
    if (systemToken) {
      const me = await graph('me', systemToken, { fields: 'id,name' });
      return send(res, 200, {
        ok: true,
        authenticated: true,
        authMode: 'system_user',
        identity: { id: me.id, name: me.name || 'Meta System User' },
        businessIdConfigured: Boolean(getBusinessId()),
        graphVersion: process.env.META_GRAPH_VERSION || 'v26.0'
      });
    }

    const userToken = getUserToken();
    if (userToken) {
      const me = await graph('me', userToken, { fields: 'id,name' });
      return send(res, 200, {
        ok: true,
        authenticated: true,
        authMode: 'user',
        identity: { id: me.id, name: me.name },
        graphVersion: process.env.META_GRAPH_VERSION || 'v26.0'
      });
    }

    return send(res, 500, {
      ok: false,
      authenticated: false,
      error: 'No Meta credential is configured on the server.'
    });
  } catch (error) {
    return send(res, error.statusCode || 500, {
      ok: false,
      authenticated: false,
      error: error.message,
      meta: error.meta ? {
        code: error.meta.code,
        type: error.meta.type,
        error_subcode: error.meta.error_subcode
      } : undefined
    });
  }
}
