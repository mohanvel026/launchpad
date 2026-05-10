const redis = require('redis');

let redisClient;

const getRedis = async () => {
  if (!redisClient) {
    redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
    });
    redisClient.on('error', (err) => console.warn('Redis analytics error:', err.message));
    await redisClient.connect();
  }
  return redisClient;
};

// Record a visit to a project's deployed app
const recordVisit = async (projectId, responseTime = 0, statusCode = 200) => {
  const key    = `analytics:${projectId}`;
  const dayKey = `analytics:${projectId}:${new Date().toISOString().slice(0, 10)}`;

  try {
    const client = await getRedis();

    // Increment total visits
    await client.hIncrBy(key, 'totalVisits', 1);
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

  } catch (err) {
    console.warn('Analytics record error:', err.message);
  }
};

// Get analytics summary for a project
const getAnalytics = async (projectId) => {
  const key = `analytics:${projectId}`;
  try {
    const client = await getRedis();
    const data   = await client.hGetAll(key);

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
    };
  } catch (err) {
    return { totalVisits: 0, totalErrors: 0, avgResponseTime: 0, days: [] };
  }
};

// Reset analytics for a project
const resetAnalytics = async (projectId) => {
  try {
    const client = await getRedis();
    await client.del(`analytics:${projectId}`);
  } catch (err) {
    console.warn('Analytics reset error:', err.message);
  }
};

module.exports = { recordVisit, getAnalytics, resetAnalytics };