const { Redis } = require('@upstash/redis');

// Create Redis client
const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "https://enabled-mako-38693.upstash.io",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "ApclAAIgcDLXJyE672YX0dBKYh4ND1v4jTMZcPohUunn9I7mqkgrlA",
});

// Test connection
(async () => {
  try {
    await redisClient.ping();
    console.log("✅ Upstash Redis connected");
  } catch (err) {
    console.error("❌ Upstash Redis connection failed:", err.message);
  }
})();

// Simple in-memory cache as fallback
const memoryCache = new Map();

const getCache = async (key) => {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn('Cache get error:', error.message);
    return memoryCache.get(key) || null;
  }
};

const setCache = async (key, value, ttlSeconds = 300) => {
  try {
    await redisClient.set(key, JSON.stringify(value), {
      ex: ttlSeconds,
    });
  } catch (error) {
    console.warn('Cache set error:', error.message);
    memoryCache.set(key, value);
    setTimeout(() => memoryCache.delete(key), ttlSeconds * 1000);
  }
};

const deleteCache = async (key) => {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.warn('Cache delete error:', error.message);
    memoryCache.delete(key);
  }
};

// Middleware for caching GET responses
const cacheMiddleware = (ttlSeconds = 300) => {
  return async (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const key = `cache:${req.originalUrl}`;

    try {
      const cached = await getCache(key);
      if (cached) {
        console.log(`Cache hit for ${key}`);
        return res.json(cached);
      }
    } catch (error) {
      console.warn('Cache middleware error:', error.message);
    }

    // Override res.json to cache the response
    const originalJson = res.json;
    res.json = function(data) {
      setCache(key, data, ttlSeconds).catch(err => console.warn('Cache set error:', err.message));
      originalJson.call(this, data);
    };

    next();
  };
};

const invalidateCacheMiddleware = (keysOrFunc) => {
  return async (req, res, next) => {
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      // Invalidate caches before the operation
      const keys = typeof keysOrFunc === 'function' ? keysOrFunc(req) : keysOrFunc;
      for (const key of keys) {
        await deleteCache(key);
      }
    }
    next();
  };
};

module.exports = { getCache, setCache, cacheMiddleware, invalidateCacheMiddleware };