import app from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { createServer } from 'node:http';
import { initSocket } from './lib/socket.js';
import { connectMongo, isMongoConnected } from './lib/mongo.js';
import { initKafkaProducer, isKafkaProducerReady } from './lib/kafka.js';
import { initGalleryKafkaConsumer } from './services/galleryKafkaConsumer.service.js';
import { syncFromPostgres } from './services/galleryMongo.service.js';
import { initChatKafkaConsumer } from './services/messageKafkaConsumer.service.js';
import { syncMessagesFromPostgres } from './services/messageMongo.service.js';

const server = createServer(app);
initSocket(server);

server.listen(env.port, async () => {
  console.log('\n======================================================');
  console.log(` 🚀 UEIBI Server Running on port ${env.port} [${env.nodeEnv}]`);
  console.log(` ⚡ Socket.IO: Active on port ${env.port}`);

  // The three stores initialize CONCURRENTLY. They used to run in sequence,
  // which put MongoDB and Kafka behind ensureAppraisalColumns() — a schema check
  // that takes ~90s against a remote database. The server accepts traffic as
  // soon as it listens, so during that window every chat read silently fell back
  // to PostgreSQL and every event took the write-through path. Racing them
  // shrinks that degraded window to roughly the slowest single connection.

  // ── PostgreSQL ──
  const pgTask = (async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(' 🐘 PostgreSQL: Connected (Healthy)');
      const { ensureAppraisalColumns } = await import('./lib/dbInit.js');
      await ensureAppraisalColumns();
      return true;
    } catch (err) {
      console.error(' ❌ PostgreSQL: Connection FAILED -', err.message);
      return false;
    }
  })();

  // ── MongoDB ──
  const mongoTask = (async () => {
    try {
      const connected = await connectMongo();
      if (!connected) return false;
      const isAtlas = env.mongodbUri.includes('mongodb+srv');
      console.log(` 🍃 MongoDB: Connected (${isAtlas ? 'MongoDB Atlas Cloud' : 'Local Docker Container :27017'})`);
      // Backfills read from PostgreSQL, so they wait for it — but only the
      // connection above gates the read path, and that is already live.
      await pgTask;
      await syncFromPostgres(prisma);
      await syncMessagesFromPostgres(prisma);
      return true;
    } catch (err) {
      console.warn(' ⚠️ MongoDB: Initialization error:', err.message);
      return false;
    }
  })();

  // ── Apache Kafka Producer & Consumers ──
  const kafkaTask = (async () => {
    try {
      const producer = await initKafkaProducer();
      const [galleryConsumer, chatConsumer] = await Promise.all([
        initGalleryKafkaConsumer(),
        initChatKafkaConsumer(),
      ]);
      const ready = Boolean(producer && galleryConsumer && chatConsumer);
      if (ready) {
        console.log(` 📨 Apache Kafka: Producer & Consumers Active [Docker Broker: ${env.kafkaBrokers.join(', ')}]`);
        console.log(`    - Topics: ${env.kafkaTopicGallery}, ${env.kafkaTopicChat}`);
      }
      return ready;
    } catch (err) {
      console.warn(' ⚠️ Kafka: Initialization error:', err.message);
      return false;
    }
  })();

  const [pgConnected, mongoConnected, kafkaReady] = await Promise.all([pgTask, mongoTask, kafkaTask]);

  console.log('------------------------------------------------------');
  console.log(' 📦 Infrastructure Status:');
  console.log(`    - PostgreSQL Database:  ${pgConnected ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
  console.log(`    - MongoDB Store:        ${mongoConnected ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
  console.log(`    - Kafka Event Stream:   ${kafkaReady ? '🟢 ONLINE (Docker :9092)' : '🟡 FALLBACK DIRECT'}`);
  console.log('------------------------------------------------------');
  console.log(` 📜 Swagger Docs: http://localhost:${env.port}/api-docs`);
  console.log('======================================================\n');
});
