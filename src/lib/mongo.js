import mongoose from 'mongoose';
import dns from 'node:dns';
import { env } from '../config/env.js';

// Ensure SRV DNS records for mongodb+srv:// resolve reliably on Windows
if (dns && typeof dns.setServers === 'function') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch { /* non-fatal fallback to system DNS */ }
}

let isConnected = false;

mongoose.connection.on('connected', () => {
  isConnected = true;
  console.log(' Database: Connected (MongoDB)');
});

mongoose.connection.on('error', (err) => {
  isConnected = false;
  console.warn(` [MongoDB] Connection error: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.log(' [MongoDB] Disconnected');
});

export async function connectMongo() {
  if (isConnected || mongoose.connection.readyState === 1) {
    return true;
  }

  const uri = env.mongodbUri;
  if (!uri) {
    console.log(' [MongoDB] No MONGODB_URI configured. Operating in PostgreSQL-only mode.');
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    });
    isConnected = true;
    return true;
  } catch (err) {
    isConnected = false;
    console.warn(` [MongoDB] Notice: Could not connect to MongoDB at ${uri} (${err.message}). Operating with resilient PostgreSQL fallback.`);
    return false;
  }
}

export async function disconnectMongo() {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
  }
}

export function isMongoConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

export { mongoose };
