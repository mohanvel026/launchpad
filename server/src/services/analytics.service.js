const redis = require('redis');

let redisClient;

const getRedis = async () => {
  if (!redisClient) {
    const client = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        connectTimeout: 1500,
      },
    });
    client.on('error', (err) => console.warn('Redis analytics error:', err.message));
    try {
      await client.connect();
      redisClient = client;
    } catch (e) {
      console.warn('Redis connect failed, falling back to mock analytics client:', e.message);
      redisClient = {
        hIncrBy: async () => 1,
        hGet: async () => null,
        hSet: async () => {},
        hGetAll: async () => ({}),
        expire: async () => {},
        del: async () => {},
        connect: async () => {},
      };
    }
  }
  return redisClient;
};

// Record a visit to a project's deployed app with advanced edge parameters
const recordVisit = async (projectId, responseTime = 0, statusCode = 200, method = 'GET', url = '/', ip = '127.0.0.1') => {
  const key    = `analytics:${projectId}`;
  const dayKey = `analytics:${projectId}:${new Date().toISOString().slice(0, 10)}`;
  const logsKey = `analytics:${projectId}:logs`;
  const routesKey = `analytics:${projectId}:routes`;

  try {
    const client = await getRedis();

    // Increment total visits
    await client.hIncrBy(key, 'totalVisits', 1);
    await client.hSet(key, 'lastTrafficAt', Date.now().toString());
    await client.hIncrBy(dayKey, 'visits', 1);
    await client.expire(dayKey, 60 * 60 * 24 * 30); // keep 30 days

    // Track errors
    if (statusCode >= 400) {
      await client.hIncrBy(key, 'totalErrors', 1);
      await client.hIncrBy(dayKey, 'errors', 1);
    }

    // Track response time (running average)
    const current = await client.hGet(key, 'avgResponseTime');
    const visits  = await client.hGet(key, 'totalVisits');
    const newAvg  = current
      ? Math.round((parseFloat(current) * (parseInt(visits) - 1) + responseTime) / parseInt(visits))
      : responseTime;
    await client.hSet(key, 'avgResponseTime', newAvg);

    // 1. Record route hit (strip query params for clean aggregation)
    const cleanUrl = url.split('?')[0] || '/';
    await client.hIncrBy(routesKey, `${method} ${cleanUrl}`, 1);

    // 2. Push to rolling access logs list (max 20 entries)
    const logEntry = JSON.stringify({
      method,
      url: cleanUrl,
      statusCode,
      responseTime,
      ip,
      timestamp: new Date().toISOString()
    });
    // Check if lPush is supported or use fallbacks
    if (typeof client.lPush === 'function') {
      await client.lPush(logsKey, logEntry);
      await client.lTrim(logsKey, 0, 19);
    } else if (typeof client.lpush === 'function') {
      await client.lpush(logsKey, logEntry);
      await client.ltrim(logsKey, 0, 19);
    }

  } catch (err) {
    console.warn('Analytics record error:', err.message);
  }
};

// Get analytics summary for a project
const getAnalytics = async (projectId) => {
  const key = `analytics:${projectId}`;
  const logsKey = `analytics:${projectId}:logs`;
  const routesKey = `analytics:${projectId}:routes`;

  try {
    const client = await getRedis();
    const data   = await client.hGetAll(key);

    // 1. Fetch rolling access logs (last 20 entries)
    let logs = [];
    try {
      const rawLogs = typeof client.lRange === 'function'
        ? await client.lRange(logsKey, 0, 19)
        : (typeof client.lrange === 'function' ? await client.lrange(logsKey, 0, 19) : []);
      logs = rawLogs.map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch (logErr) {
      console.warn('Failed to fetch rolling access logs:', logErr.message);
    }

    // 2. Fetch top route hits
    let routes = [];
    try {
      const rawRoutes = await client.hGetAll(routesKey);
      routes = Object.entries(rawRoutes || {}).map(([route, hits]) => {
        const parts = route.split(' ');
        const method = parts[0] || 'GET';
        const path = parts.slice(1).join(' ') || '/';
        return { method, path, hits: parseInt(hits || 0) };
      }).sort((a, b) => b.hits - a.hits).slice(0, 10); // top 10 routes
    } catch (routeErr) {
      console.warn('Failed to fetch route hits:', routeErr.message);
    }

    // Get last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date   = new Date();
      date.setDate(date.getDate() - i);
      const dayKey = `analytics:${projectId}:${date.toISOString().slice(0, 10)}`;
      const day    = await client.hGetAll(dayKey);
      days.push({
        date:   date.toISOString().slice(0, 10),
        visits: parseInt(day.visits  || 0),
        errors: parseInt(day.errors || 0),
      });
    }

    return {
      totalVisits:     parseInt(data.totalVisits     || 0),
      totalErrors:     parseInt(data.totalErrors     || 0),
      avgResponseTime: parseInt(data.avgResponseTime || 0),
      uptime:          data.uptime || '100%',
      days,
      logs,
      routes
    };
  } catch (err) {
    return { totalVisits: 0, totalErrors: 0, avgResponseTime: 0, days: [], logs: [], routes: [] };
  }
};

// Reset analytics for a project
const resetAnalytics = async (projectId) => {
  try {
    const client = await getRedis();
    await client.del(`analytics:${projectId}`);
    await client.del(`analytics:${projectId}:logs`);
    await client.del(`analytics:${projectId}:routes`);
  } catch (err) {
    console.warn('Analytics reset error:', err.message);
  }
};

module.exports = { recordVisit, getAnalytics, resetAnalytics };