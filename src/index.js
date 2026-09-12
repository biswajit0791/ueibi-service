import app from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { createServer } from 'node:http';
import { initSocket } from './lib/socket.js';
import { connectMongo, isMongoConnected } from './lib/mongo.js';
import { initKafkaProducer, isKafkaProducerReady } from './lib/kafka.js';
import { initGalleryKafkaConsumer } from './services/galleryKafkaConsumer.service.js';
import { syncFromPostgres } from './services/galleryMongo.service.js';

const server = createServer(app);
initSocket(server);

server.listen(env.port, async () => {
  console.log('\n======================================================');
  console.log(` 🚀 UEIBI Server Running on port ${env.port} [${env.nodeEnv}]`);
  console.log(` ⚡ Socket.IO: Active on port ${env.port}`);

  // ── Database health checks ──
  let pgConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    pgConnected = true;
    console.log(' 🐘 PostgreSQL: Connected (Healthy)');
    const { ensureAppraisalColumns } = await import('./lib/dbInit.js');
    await ensureAppraisalColumns();
  } catch (err) {
    console.error(' ❌ PostgreSQL: Connection FAILED -', err.message);
  }

  // ── MongoDB connection ──
  let mongoConnected = false;
  try {
    mongoConnected = await connectMongo();
    if (mongoConnected) {
      const isAtlas = env.mongodbUri.includes('mongodb+srv');
      console.log(` 🍃 MongoDB: Connected (${isAtlas ? 'MongoDB Atlas Cloud' : 'Local Docker Container :27017'})`);
      await syncFromPostgres(prisma);
    }
  } catch (err) {
    console.warn(' ⚠️ MongoDB: Initialization error:', err.message);
  }

  // ── Apache Kafka Producer & Consumer ──
  let kafkaReady = false;
  try {
    const producer = await initKafkaProducer();
    const consumer = await initGalleryKafkaConsumer();
    kafkaReady = Boolean(producer && consumer);
    if (kafkaReady) {
      console.log(` 📨 Apache Kafka: Producer & Consumer Active [Docker Broker: ${env.kafkaBrokers.join(', ')}]`);
    }
  } catch (err) {
    console.warn(' ⚠️ Kafka: Initialization error:', err.message);
  }

  console.log('------------------------------------------------------');
  console.log(' 📦 Infrastructure Status:');
  console.log(`    - PostgreSQL Database:  ${pgConnected ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
  console.log(`    - MongoDB Store:        ${mongoConnected ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
  console.log(`    - Kafka Event Stream:   ${kafkaReady ? '🟢 ONLINE (Docker :9092)' : '🟡 FALLBACK DIRECT'}`);
  console.log('------------------------------------------------------');
  console.log(` 📜 Swagger Docs: http://localhost:${env.port}/api-docs`);
  console.log('======================================================\n');
});
