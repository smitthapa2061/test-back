const redis = require('redis');

// Create Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
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

module.exports = { getCache, setCache };