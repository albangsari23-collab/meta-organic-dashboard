import { graph, requireToken, send } from './_meta.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  try {
    const token = requireToken();
    const me = await graph('me', token, { fields: 'id,name' });
    return send(res, 200, {
      ok: true,
      authenticated: true,
      identity: { id: me.id, name: me.name },
      graphVersion: process.env.META_GRAPH_VERSION || 'v26.0'
    });
  } catch (error) {
    return send(res, error.statusCode || 500, {
      ok: false,
      error: error.message,
      meta: error.meta ? { code: error.meta.code, type: error.meta.type } : undefined
    });
  }
}
