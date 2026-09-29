import { graph, requireToken, send } from './_meta.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  try {
    const userToken = requireToken();
    const result = await graph('me/accounts', userToken, {
      fields: 'name,id,tasks,instagram_business_account,access_token',
      limit: 100
    });

    const accounts = (result.data || []).map((page) => ({
      pageId: page.id,
      pageName: page.name,
      tasks: page.tasks || [],
      instagramBusinessAccountId: page.instagram_business_account?.id || null,
      hasInstagram: Boolean(page.instagram_business_account?.id)
    }));

    return send(res, 200, {
      graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
      accounts
    });
  } catch (error) {
    return send(res, error.statusCode || 500, {
      error: error.message,
      meta: error.meta ? { code: error.meta.code, type: error.meta.type } : undefined
    });
  }
}
