import {
  getConfiguredPage,
  getSystemUserToken,
  getUserToken,
  graph,
  metricValue,
  normalizeDate,
  pMapLimit,
  safeInt,
  send
} from './_meta.js';

const CONTENT_LIMIT = Math.min(
  Math.max(Number(process.env.META_POST_LIMIT || 100), 60),
  120
);

function uniqueTokens(...tokens) {
  return [...new Set(tokens.filter(Boolean))];
}

async function graphWithFallback(path, tokens, params = {}) {
  let lastError;
  for (const token of uniqueTokens(...tokens)) {
    try {
      return await graph(path, token, params);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  const error = new Error('No usable Meta credential is available for this request.');
  error.statusCode = 401;
  throw error;
}

async function getPageContext(userToken, systemToken, pageId) {
  const configured = getConfiguredPage(pageId);
  if (configured) {
    try {
      const remote = await graph(pageId, configured.access_token, {
        fields: 'id,name,instagram_business_account'
      });
      return {
        ...configured,
        ...remote,
        access_token: configured.access_token,
        auth_mode: 'page_access_token'
      };
    } catch (_) {
      // Continue to System User / User token fallbacks.
    }
  }

  if (systemToken) {
    try {
      const page = await graph(pageId, systemToken, {
        fields: 'id,name,instagram_business_account'
      });
      return {
        ...page,
        access_token: systemToken,
        tasks: [],
        auth_mode: 'system_user'
      };
    } catch (_) {
      // Continue to User token fallback.
    }
  }

  if (userToken) {
    const result = await graph('me/accounts', userToken, {
      fields: 'name,id,tasks,instagram_business_account,access_token',
      limit: 100
    });
    const page = (result.data || []).find((item) => String(item.id) === String(pageId));
    if (page?.access_token) {
      return { ...page, auth_mode: 'user' };
    }
  }

  const error = new Error(
    'Selected Facebook Page has no usable credential. Configure a permanent Page token or System User token, or reconnect the User token.'
  );
  error.statusCode = 401;
  throw error;
}

async function collectPages(path, token, params, maxItems, stopWhen) {
  const out = [];
  let after = null;

  while (out.length < maxItems) {
    const page = await graph(path, token, {
      ...params,
      limit: Math.min(50, maxItems - out.length),
      ...(after ? { after } : {})
    });

    const rows = page.data || [];
    out.push(...rows);

    if (!rows.length || stopWhen?.(rows, out)) break;

    const nextAfter = page.paging?.cursors?.after;
    if (!nextAfter || nextAfter === after) break;
    after = nextAfter;
  }

  return out.slice(0, maxItems);
}

async function collectPagesWithFallback(path, tokens, params, maxItems, stopWhen) {
  let lastError;
  for (const token of uniqueTokens(...tokens)) {
    try {
      return await collectPages(path, token, params, maxItems, stopWhen);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function getFacebookPosts(page, since, until) {
  const params = {
    fields: 'id,message,created_time,permalink_url,full_picture'
  };
  if (since) params.since = since;
  if (until) params.until = until;

  const posts = await collectPages(
    `${page.id}/posts`,
    page.access_token,
    params,
    CONTENT_LIMIT
  );

  return pMapLimit(posts, 7, async (post) => {
    const [engagement, insights] = await Promise.all([
      graph(post.id, page.access_token, {
        fields: 'id,message,created_time,permalink_url,full_picture,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares'
      }).catch(() => post),
      graph(`${post.id}/insights`, page.access_token, {
        metric: 'post_media_view,post_total_media_view_unique,post_clicks,post_reactions_by_type_total'
      }).catch(() => ({ data: [] }))
    ]);

    const reactions = safeInt(engagement?.reactions?.summary?.total_count);
    const comments = safeInt(engagement?.comments?.summary?.total_count);
    const shares = safeInt(engagement?.shares?.count);
    const views = metricValue(insights.data, 'post_media_view');
    const reach = metricValue(insights.data, 'post_total_media_view_unique');
    const clicks = metricValue(insights.data, 'post_clicks');
    const engagements = reactions + comments + shares + clicks;

    return {
      platform: 'facebook',
      accountId: page.id,
      accountName: page.name,
      postId: post.id,
      caption: engagement.message || post.message || '',
      createdAt: normalizeDate(engagement.created_time || post.created_time),
      permalink: engagement.permalink_url || post.permalink_url || '',
      thumbnail: engagement.full_picture || post.full_picture || '',
      mediaType: 'POST',
      mediaProductType: 'FEED',
      views,
      reach,
      likes: reactions,
      reactions,
      comments,
      shares,
      saves: 0,
      clicks,
      engagements,
      engagementRate: reach > 0 ? (engagements / reach) * 100 : 0
    };
  });
}

async function getInstagramInsights(mediaId, tokens) {
  const attempts = [
    'views,reach,shares,saved,total_interactions',
    'reach,shares,saved,total_interactions',
    'reach,total_interactions',
    'reach'
  ];
  for (const metric of attempts) {
    try {
      return await graphWithFallback(`${mediaId}/insights`, tokens, { metric });
    } catch (_) {}
  }
  return { data: [] };
}

async function getInstagram(page, userToken, systemToken, since, until) {
  const igId = page.instagram_business_account?.id;
  if (!igId) return { profile: null, posts: [] };

  const tokens = uniqueTokens(page.access_token, systemToken, userToken);

  const profile = await graphWithFallback(igId, tokens, {
    fields: 'id,username,name,followers_count,media_count'
  });

  const sinceTs = since ? new Date(since + 'T00:00:00Z').getTime() : -Infinity;
  const untilTs = until ? new Date(until + 'T23:59:59.999Z').getTime() : Infinity;

  const media = await collectPagesWithFallback(
    `${igId}/media`,
    tokens,
    {
      fields: 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count'
    },
    CONTENT_LIMIT,
    (rows) => {
      if (!Number.isFinite(sinceTs)) return false;
      const oldest = rows[rows.length - 1]?.timestamp;
      return oldest ? new Date(oldest).getTime() < sinceTs : false;
    }
  );

  const filtered = media.filter((item) => {
    const ts = new Date(item.timestamp).getTime();
    return ts >= sinceTs && ts <= untilTs;
  });

  const posts = await pMapLimit(filtered, 7, async (item) => {
    const insights = await getInstagramInsights(item.id, tokens);
    const views = metricValue(insights.data, 'views');
    const reach = metricValue(insights.data, 'reach');
    const shares = metricValue(insights.data, 'shares');
    const saves = metricValue(insights.data, 'saved');
    const totalInteractions = metricValue(insights.data, 'total_interactions');
    const likes = safeInt(item.like_count);
    const comments = safeInt(item.comments_count);
    const engagements = totalInteractions || (likes + comments + shares + saves);

    return {
      platform: 'instagram',
      accountId: igId,
      accountName: profile.username ? `@${profile.username}` : (profile.name || page.name),
      postId: item.id,
      caption: item.caption || '',
      createdAt: normalizeDate(item.timestamp),
      permalink: item.permalink || '',
      thumbnail: item.thumbnail_url || item.media_url || '',
      mediaType: item.media_type || 'UNKNOWN',
      mediaProductType: item.media_product_type || 'FEED',
      views,
      reach,
      likes,
      reactions: likes,
      comments,
      shares,
      saves,
      clicks: 0,
      engagements,
      engagementRate: reach > 0 ? (engagements / reach) * 100 : 0
    };
  });

  return {
    profile: {
      id: profile.id,
      username: profile.username || null,
      name: profile.name || null,
      followers: safeInt(profile.followers_count),
      mediaCount: safeInt(profile.media_count)
    },
    posts
  };
}

function summarize(posts) {
  const totals = posts.reduce((acc, post) => {
    acc.views += safeInt(post.views);
    acc.reach += safeInt(post.reach);
    acc.engagements += safeInt(post.engagements);
    acc.likes += safeInt(post.likes);
    acc.comments += safeInt(post.comments);
    acc.shares += safeInt(post.shares);
    acc.saves += safeInt(post.saves);
    acc.clicks += safeInt(post.clicks);
    acc.posts += 1;
    return acc;
  }, {
    views: 0,
    reach: 0,
    engagements: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    clicks: 0,
    posts: 0
  });

  totals.engagementRate = totals.reach > 0
    ? (totals.engagements / totals.reach) * 100
    : 0;
  totals.avgViews = totals.posts ? totals.views / totals.posts : 0;
  totals.avgReach = totals.posts ? totals.reach / totals.posts : 0;
  return totals;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  try {
    const userToken = getUserToken();
    const systemToken = getSystemUserToken();
    const pageId = req.query?.pageId;
    const since = req.query?.since || '';
    const until = req.query?.until || '';

    if (!pageId) return send(res, 400, { error: 'pageId is required' });

    const page = await getPageContext(userToken, systemToken, pageId);
    const [facebookPosts, instagram] = await Promise.all([
      getFacebookPosts(page, since, until),
      getInstagram(page, userToken, systemToken, since, until)
    ]);

    const posts = [...facebookPosts, ...instagram.posts]
      .filter((item) => !item.__error)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const totals = summarize(posts);
    const platformTotals = {
      facebook: summarize(posts.filter((p) => p.platform === 'facebook')),
      instagram: summarize(posts.filter((p) => p.platform === 'instagram'))
    };

    const typeTotals = {};
    for (const post of posts) {
      const type = post.mediaProductType === 'REELS'
        ? 'REELS'
        : (post.mediaType || 'POST');
      if (!typeTotals[type]) typeTotals[type] = [];
      typeTotals[type].push(post);
    }

    const contentTypes = Object.entries(typeTotals)
      .map(([type, rows]) => ({ type, ...summarize(rows) }))
      .sort((a, b) => b.views - a.views);

    return send(res, 200, {
      syncedAt: new Date().toISOString(),
      graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
      authMode: page.auth_mode || 'user',
      coverage: {
        perPlatformLimit: CONTENT_LIMIT,
        requestedSince: since || null,
        requestedUntil: until || null,
        facebookLoaded: facebookPosts.length,
        instagramLoaded: instagram.posts.length
      },
      page: {
        id: page.id,
        name: page.name,
        hasInstagram: Boolean(page.instagram_business_account?.id),
        instagramBusinessAccountId: page.instagram_business_account?.id || null
      },
      instagramProfile: instagram.profile,
      totals,
      platformTotals,
      contentTypes,
      posts
    });
  } catch (error) {
    return send(res, error.statusCode || 500, {
      error: error.message,
      reconnectRequired: error.meta?.code === 190 || error.statusCode === 401,
      meta: error.meta ? {
        code: error.meta.code,
        type: error.meta.type,
        error_subcode: error.meta.error_subcode
      } : undefined
    });
  }
}
