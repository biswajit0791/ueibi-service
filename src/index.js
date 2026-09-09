import app from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { createServer } from 'node:http';
import { initSocket } from './lib/socket.js';

const server = createServer(app);
initSocket(server);

server.listen(env.port, async () => {
  console.log(`\n UEIBI Server listening on port ${env.port} [${env.nodeEnv}]`);
  console.log(` Socket.IO: Real-time synchronization active on port ${env.port}`);
  // Nodemon reload triggered cleanly

  // ── Database health check ──
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(' Database: Connected (PostgreSQL)');
    const { ensureAppraisalColumns } = await import('./lib/dbInit.js');
    await ensureAppraisalColumns();
  } catch (err) {
    console.error(' Database: Connection FAILED -', err.message);
  }

  console.log(` Swagger Docs: http://localhost:${env.port}/api-docs\n`);
});


