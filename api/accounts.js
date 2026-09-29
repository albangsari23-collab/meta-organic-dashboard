import {
  getBusinessId,
  getConfiguredPages,
  getSystemUserToken,
  getUserToken,
  graph,
  send
} from './_meta.js';

function publicPage(page) {
  return {
    pageId: page.id,
    pageName: page.name,
    tasks: page.tasks || [],
    instagramBusinessAccountId: page.instagram_business_account?.id || null,
    hasInstagram: Boolean(page.instagram_business_account?.id),
    authMode: page.auth_mode || 'user'
  };
}

function mergePages(target, pages) {
  for (const page of pages || []) {
    if (!page?.id) continue;
    const existing = target.get(String(page.id)) || {};
    target.set(String(page.id), {
      ...existing,
      ...page,
      tasks: page.tasks || existing.tasks || [],
      instagram_business_account:
        page.instagram_business_account || existing.instagram_business_account || null
    });
  }
}

async function resolveConfiguredPages() {
  const configured = getConfiguredPages();
  const resolved = await Promise.all(configured.map(async (page) => {
    try {
      const remote = await graph(page.id, page.access_token, {
        fields: 'id,name,instagram_business_account'
      });
      return {
        ...page,
        ...remote,
        access_token: page.access_token,
        auth_mode: 'page_access_token'
      };
    } catch (_) {
      return page;
    }
  }));
  return resolved;
}

async function getBusinessPages(systemToken, businessId) {
  if (!systemToken || !businessId) return [];
  const fields = 'id,name,instagram_business_account';
  const groups = await Promise.all([
    graph(`${businessId}/owned_pages`, systemToken, { fields, limit: 100 }).catch(() => ({ data: [] })),
    graph(`${businessId}/client_pages`, systemToken, { fields, limit: 100 }).catch(() => ({ data: [] }))
  ]);

  return groups.flatMap((group) => group.data || []).map((page) => ({
    ...page,
    access_token: systemToken,
    auth_mode: 'system_user'
  }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const pages = new Map();
  const warnings = [];

  try {
    mergePages(pages, await resolveConfiguredPages());

    const systemToken = getSystemUserToken();
    const businessId = getBusinessId();
    if (systemToken && businessId) {
      const businessPages = await getBusinessPages(systemToken, businessId);
      mergePages(pages, businessPages);
      if (!businessPages.length) {
        warnings.push('System User token is configured, but no assigned Business pages were returned.');
      }
    }

    const userToken = getUserToken();
    if (userToken) {
      try {
        const result = await graph('me/accounts', userToken, {
          fields: 'name,id,tasks,instagram_business_account,access_token',
          limit: 100
        });
        mergePages(
          pages,
          (result.data || []).map((page) => ({ ...page, auth_mode: 'user' }))
        );
      } catch (error) {
        warnings.push(error.message);
      }
    }

    const accounts = [...pages.values()].map(publicPage);
    if (!accounts.length) {
      const error = new Error(
        warnings[0]
        || 'No usable Meta Page credential is configured. Add a permanent Page token, a System User token, or reconnect the User token.'
      );
      error.statusCode = 401;
      throw error;
    }

    return send(res, 200, {
      graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
      accounts,
      auth: {
        configuredPageTokens: getConfiguredPages().length,
        systemUserConfigured: Boolean(systemToken),
        businessIdConfigured: Boolean(businessId),
        userTokenConfigured: Boolean(userToken)
      },
      warning: warnings.length ? warnings.join(' ') : undefined
    });
  } catch (error) {
    return send(res, error.statusCode || 500, {
      error: error.message,
      meta: error.meta ? { code: error.meta.code, type: error.meta.type } : undefined
    });
  }
}
