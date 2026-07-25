import 'dotenv/config';

const required = ['DATABASE_URL'];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[env] Missing required environment variable: ${key}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
