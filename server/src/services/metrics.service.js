const Docker  = require('dockerode');
const redis   = require('redis');

const docker = new Docker(
  process.platform === 'win32'
    ? { host: '127.0.0.1', port: 2375 }
    : { socketPath: '/var/run/docker.sock' }
);

// Redis client for caching metrics (short TTL)
let redisClient;
let connectPromise;
const getRedis = async () => {
  if (redisClient) return redisClient;

  if (!connectPromise) {
    const client = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
    });
    client.on('error', (err) => console.warn('Redis metrics error:', err.message));

    connectPromise = client.connect()
      .then(() => {
        redisClient = client;
        return client;
      })
      .catch((e) => {
        console.warn('Redis metrics connect failed:', e.message);
        connectPromise = null; // reset to allow retry on next call
        throw e;
      });
  }
  return connectPromise;
};

// Fetch real-time stats for a single container
const getContainerStats = async (containerId) => {
  try {
    const container = docker.getContainer(containerId);
    const stats     = await container.stats({ stream: false });

    const cpuDelta    = stats.cpu_stats.cpu_usage.total_usage  - stats.precpu_stats.cpu_usage.total_usage;
    const sysDelta    = stats.cpu_stats.system_cpu_usage        - stats.precpu_stats.system_cpu_usage;
    const numCpus     = stats.cpu_stats.online_cpus || 1;
    const cpuPercent  = sysDelta > 0 ? (cpuDelta / sysDelta) * numCpus * 100 : 0;

    const memUsage = stats.memory_stats.usage || 0;
    const memLimit = stats.memory_stats.limit || 1;

    // Network I/O
    const networks  = stats.networks || {};
    const rxBytes   = Object.values(networks).reduce((sum, n) => sum + (n.rx_bytes || 0), 0);
    const txBytes   = Object.values(networks).reduce((sum, n) => sum + (n.tx_bytes || 0), 0);

    return {
      cpu:      Math.round(cpuPercent * 100) / 100,      // percent
      memMB:    Math.round(memUsage / 1024 / 1024),      // megabytes
      memPct:   Math.round((memUsage / memLimit) * 100), // percent of limit
      memLimit: Math.round(memLimit / 1024 / 1024),      // limit in MB
      rxMB:     Math.round(rxBytes / 1024 / 1024 * 100) / 100,
      txMB:     Math.round(txBytes / 1024 / 1024 * 100) / 100,
      status:   'running',
      ts:       Date.now(),
    };
  } catch (err) {
    // Container may have stopped
    return { cpu: 0, memMB: 0, memPct: 0, status: 'stopped', ts: Date.now() };
  }
};

// Cache metrics in Redis with a 10-second TTL
const getCachedStats = async (containerId) => {
  const key = `metrics:${containerId}`;
  try {
    const client = await getRedis();
    const cached = await client.get(key);
    if (cached) return JSON.parse(cached);

    const stats = await getContainerStats(containerId);
    await client.setEx(key, 10, JSON.stringify(stats));
    return stats;
  } catch {
    // Redis unavailable — fetch directly
    return getContainerStats(containerId);
  }
};

// Get historical metric snapshots stored in Redis (ring buffer of last 60 entries)
const recordMetricSnapshot = async (projectId, stats) => {
  const key = `metrics:history:${projectId}`;
  try {
    const client = await getRedis();
    await client.lPush(key, JSON.stringify(stats));
    await client.lTrim(key, 0, 59);   // keep last 60 snapshots (10 minutes at 10s intervals)
    await client.expire(key, 3600);
  } catch (err) {
    console.warn('Metrics record error:', err.message);
  }
};

const getMetricHistory = async (projectId) => {
  const key = `metrics:history:${projectId}`;
  try {
    const client  = await getRedis();
    const entries = await client.lRange(key, 0, -1);
    return entries.map((e) => JSON.parse(e)).reverse(); // oldest first
  } catch {
    return [];
  }
};

module.exports = { getContainerStats, getCachedStats, recordMetricSnapshot, getMetricHistory };