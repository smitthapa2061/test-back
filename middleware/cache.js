const { createClient } = require('redis');

// Create Redis client
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_URL || "rediss://default_ro:ApclAAIgcDLXJyE672YX0dBKYh4ND1v4jTMZcPohUunn9I7mqkgrlA@enabled-mako-38693.upstash.io:6379",
    port: 6379,
    reconnectStrategy: retries => Math.min(retries * 100, 3000)
  }
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});
redisClient.on('connect', () => {
  console.log('✅ Redis connected successfully');
});
redisClient.connect().catch(console.error);

// Simple in-memory cache as fallback
const memoryCache = new Map();

const getCache = async (key) => {
  try {
    if (redisClient.isOpen) {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } else {
      return memoryCache.get(key) || null;
    }
  } catch (error) {
    console.warn('Cache get error:', error.message);
    return memoryCache.get(key) || null;
  }
};

const setCache = async (key, value, ttlSeconds = 300) => {
  try {
    const serializedValue = JSON.stringify(value);
    if (redisClient.isOpen) {
      await redisClient.setEx(key, ttlSeconds, serializedValue);
    } else {
      memoryCache.set(key, value);
      // Simple TTL for memory cache
      setTimeout(() => memoryCache.delete(key), ttlSeconds * 1000);
    }
  } catch (error) {
    console.warn('Cache set error:', error.message);
    memoryCache.set(key, value);
    setTimeout(() => memoryCache.delete(key), ttlSeconds * 1000);
  }
};

const deleteCache = async (key) => {
  try {
    if (redisClient.isOpen) {
      await redisClient.del(key);
    } else {
      memoryCache.delete(key);
    }
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