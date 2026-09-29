import {
  graph,
  metricValue,
  normalizeDate,
  pMapLimit,
  requireToken,
  safeInt,
  send
} from './_meta.js';

const POST_LIMIT = Math.min(Math.max(Number(process.env.META_POST_LIMIT || 25), 5), 100);

async function getPageContext(userToken, pageId) {
  const result = await graph('me/accounts', userToken, {
    fields: 'name,id,tasks,instagram_business_account,access_token',
    limit: 100
  });
  const page = (result.data || []).find((item) => String(item.id) === String(pageId));
  if (!page) {
    const error = new Error('Selected Facebook Page is not available to this token.');
    error.statusCode = 404;
    throw error;
  }
  if (!page.access_token) {
    const error = new Error('Meta did not return a Page access token for this Page.');
    error.statusCode = 403;
    throw error;
  }
  return page;
}

async function getFacebookPosts(page, since, until) {
  const params = {
    fields: 'id,message,created_time,permalink_url,full_picture',
    limit: POST_LIMIT
  };
  if (since) params.since = since;
  if (until) params.until = until;

  const feed = await graph(`${page.id}/posts`, page.access_token, params);
  const posts = feed.data || [];

  return pMapLimit(posts, 5, async (post) => {
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

async function getInstagramInsights(mediaId, userToken) {
  const attempts = [
    'views,reach,shares,saved,total_interactions',
    'reach,shares,saved,total_interactions',
    'reach,total_interactions'
  ];
  for (const metric of attempts) {
    try {
      return await graph(`${mediaId}/insights`, userToken, { metric });
    } catch (_) {}
  }
  return { data: [] };
}

async function getInstagram(page, userToken, since, until) {
  const igId = page.instagram_business_account?.id;
  if (!igId) return { profile: null, posts: [] };

  const profile = await graph(igId, userToken, {
    fields: 'id,username,name,followers_count,media_count'
  });

  const media = await graph(`${igId}/media`, userToken, {
    fields: 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count',
    limit: POST_LIMIT
  });

  const from = since ? new Date(since).getTime() : -Infinity;
  const to = until ? new Date(until).getTime() + 86400000 - 1 : Infinity;
  const filtered = (media.data || []).filter((item) => {
    const ts = new Date(item.timestamp).getTime();
    return ts >= from && ts <= to;
  });

  const posts = await pMapLimit(filtered, 5, async (item) => {
    const insights = await getInstagramInsights(item.id, userToken);
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  try {
    const userToken = requireToken();
    const pageId = req.query?.pageId;
    const since = req.query?.since || '';
    const until = req.query?.until || '';
    if (!pageId) return send(res, 400, { error: 'pageId is required' });

    const page = await getPageContext(userToken, pageId);
    const [facebookPosts, instagram] = await Promise.all([
      getFacebookPosts(page, since, until),
      getInstagram(page, userToken, since, until)
    ]);

    const posts = [...facebookPosts, ...instagram.posts]
      .filter((item) => !item.__error)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const totals = posts.reduce((acc, post) => {
      acc.views += safeInt(post.views);
      acc.reach += safeInt(post.reach);
      acc.engagements += safeInt(post.engagements);
      acc.likes += safeInt(post.likes);
      acc.comments += safeInt(post.comments);
      acc.shares += safeInt(post.shares);
      acc.saves += safeInt(post.saves);
      acc.clicks += safeInt(post.clicks);
      return acc;
    }, { views: 0, reach: 0, engagements: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 });

    totals.engagementRate = totals.reach > 0 ? (totals.engagements / totals.reach) * 100 : 0;

    return send(res, 200, {
      syncedAt: new Date().toISOString(),
      graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
      page: {
        id: page.id,
        name: page.name,
        hasInstagram: Boolean(page.instagram_business_account?.id),
        instagramBusinessAccountId: page.instagram_business_account?.id || null
      },
      instagramProfile: instagram.profile,
      totals,
      posts
    });
  } catch (error) {
    return send(res, error.statusCode || 500, {
      error: error.message,
      meta: error.meta ? { code: error.meta.code, type: error.meta.type, error_subcode: error.meta.error_subcode } : undefined
    });
  }
}
