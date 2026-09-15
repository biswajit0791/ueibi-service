import Redis from 'ioredis';
import { env } from '../config/env.js';

const redisConfig = {
  host: env.redisHost,
  port: env.redisPort,
  username: env.redisUsername,
  password: env.redisPassword,
  lazyConnect: true,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
};

export const pub = new Redis(redisConfig);
export const sub = new Redis(redisConfig);

pub.on('error', (err) => console.error('⚠️ Redis Pub Error:', err.message));
sub.on('error', (err) => console.error('⚠️ Redis Sub Error:', err.message));
