const redis = require('redis');

let redisClient;

const getRedis = async () => {
  if (!redisClient) {
    redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        reconnectStrategy: (retries) => {
          if (retries > 10) return new Error('Redis connection retries exhausted');
          return Math.min(retries * 100, 3000);
        }
      },
    });
    redisClient.on('error', () => {}); // silent fail
    await redisClient.connect().catch(() => {});
  }
  return redisClient;
};

// Rate limiter — uses Redis sliding window
// Falls back to allowing requests if Redis is unavailable
const rateLimit = (options = {}) => {
  const {
    windowMs  = 60 * 1000,   // 1 minute
    max       = 60,           // requests per window
    message   = 'Too many requests, please slow down',
    keyPrefix = 'rl',
  } = options;

  return async (req, res, next) => {
    const identifier = req.user?._id || req.ip;
    const key        = `${keyPrefix}:${identifier}`;

    try {
      const client = await getRedis();
      const now    = Date.now();
      const window = Math.floor(now / windowMs);
      const redisKey = `${key}:${window}`;

      const count = await client.incr(redisKey);
      if (count === 1) {
        await client.expire(redisKey, Math.ceil(windowMs / 1000));
      }

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit',     max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        return res.status(429).json({ message });
      }

      next();
    } catch {
      // Redis unavailable — allow request
      next();
    }
  };
};

// Specific rate limiters
const deployRateLimit = rateLimit({
  windowMs:  5 * 60 * 1000,  // 5 minutes
  max:       10,              // 10 deploys per 5 minutes
  message:   'Too many deployments. Wait 5 minutes.',
  keyPrefix: 'rl:deploy',
});

const apiRateLimit = rateLimit({
  windowMs:  60 * 1000,
  max:       120,
  message:   'API rate limit exceeded',
  keyPrefix: 'rl:api',
});

const authRateLimit = rateLimit({
  windowMs:  15 * 60 * 1000,  // 15 minutes
  max:       20,
  message:   'Too many auth attempts',
  keyPrefix: 'rl:auth',
});

module.exports = { rateLimit, deployRateLimit, apiRateLimit, authRateLimit };