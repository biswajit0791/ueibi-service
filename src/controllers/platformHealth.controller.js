/**
 * platformHealth.controller.js — Real-time Infrastructure & System Health metrics for Platform Owner.
 */
import os from 'os';
import { prisma } from '../lib/prisma.js';
import { isMongoConnected } from '../lib/mongo.js';
import { isKafkaProducerReady } from '../lib/kafka.js';

export async function getPlatformHealth(req, res, next) {
  try {
    const startDb = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - startDb;

    const uptimeSec = Math.floor(process.uptime());
    const memory = process.memoryUsage();

    const systemInfo = {
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      uptimeSeconds: uptimeSec,
      database: {
        engine: 'PostgreSQL',
        status: 'CONNECTED',
        latencyMs: dbLatencyMs,
      },
      services: {
        mongoDb: isMongoConnected() ? 'CONNECTED' : 'STANDBY',
        kafkaBroker: isKafkaProducerReady() ? 'CONNECTED' : 'DIRECT_WRITE_THROUGH',
      },
      resources: {
        memoryHeapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        memoryHeapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        freeSystemMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
        totalSystemMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
        cpuCount: os.cpus().length,
      },
    };

    // Maintenance announcements
    const activeAnnouncement = await prisma.platformAnnouncement.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      health: systemInfo,
      announcement: activeAnnouncement,
    });
  } catch (err) {
    next(err);
  }
}

export async function setPlatformAnnouncement(req, res, next) {
  try {
    const { title, message, type, isActive, endsAt } = req.body;

    const announcement = await prisma.platformAnnouncement.create({
      data: {
        title: title || 'System Notice',
        message: message || '',
        type: type || 'INFO',
        isActive: isActive !== undefined ? isActive : true,
        endsAt: endsAt ? new Date(endsAt) : null,
        createdById: req.user.id,
      },
    });

    res.status(201).json({ announcement });
  } catch (err) {
    next(err);
  }
}

