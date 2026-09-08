import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import registrationRoutes from './routes/registration.routes.js';
import financeRoutes from './routes/finance.routes.js';
import hrRoutes from './routes/hr.routes.js';
import adminRoutes from './routes/admin.routes.js';
import devRoutes from './routes/dev.routes.js';
import authRoutes from './routes/auth.routes.js';
import employeeRoutes from './routes/employee.routes.js';
import goalRoutes from './routes/goal.routes.js';
import taskRoutes from './routes/task.routes.js';
import leaveRoutes from './routes/leave.routes.js';
import appraisalRoutes from './routes/appraisal.routes.js';
import exReviewRoutes from './routes/exReview.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import registryRoutes from './routes/registry.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import activityRoutes from './routes/activity.routes.js';
import policyRoutes from './routes/policy.routes.js';
import hubRoutes from './routes/hub.routes.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

import { swaggerUiServe, swaggerUiSetup, swaggerSpec } from './config/swagger.js';

const app = express();

app.set('trust proxy', true);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
const allowedOrigins = [env.corsOrigin, 'http://localhost:5174'].filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

// Serve uploads static directory with cross-origin access
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static('uploads'));

// Root
app.get('/', (req, res) => res.json({ message: 'UEIBI server running on port 4000' }));

// Swagger API Docs
app.use('/api-docs', swaggerUiServe, swaggerUiSetup);
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

app.get('/api/backfill-hr', async (req, res) => {
  try {
    const { prisma } = await import('./lib/prisma.js');
    const registrations = await prisma.companyRegistration.findMany({
      where: { status: 'ACTIVE' },
      include: { tenant: true }
    });
    const results = [];
    for (const reg of registrations) {
      if (!reg.tenant) continue;
      
      // HR
      if (reg.hrEmail.toLowerCase() !== reg.email.toLowerCase()) {
        const existingHr = await prisma.tenantUser.findUnique({ where: { email: reg.hrEmail } });
        if (!existingHr) {
          await prisma.tenantUser.create({
            data: {
              tenantId: reg.tenant.id,
              email: reg.hrEmail,
              passwordHash: reg.passwordHash,
              name: 'HR Head',
              role: 'HR',
              status: 'ACTIVE',
              mustChangePassword: false,
              designation: 'HR Head',
            }
          });
          results.push(`Created HR: ${reg.hrEmail}`);
        }
      }
      
      // Finance
      if (reg.financeEmail.toLowerCase() !== reg.email.toLowerCase() &&
          reg.financeEmail.toLowerCase() !== reg.hrEmail.toLowerCase()) {
        const existingFin = await prisma.tenantUser.findUnique({ where: { email: reg.financeEmail } });
        if (!existingFin) {
          await prisma.tenantUser.create({
            data: {
              tenantId: reg.tenant.id,
              email: reg.financeEmail,
              passwordHash: reg.passwordHash,
              name: 'Finance Head',
              role: 'FINANCE',
              status: 'ACTIVE',
              mustChangePassword: false,
              designation: 'Finance Head',
            }
          });
          results.push(`Created Finance: ${reg.financeEmail}`);
        }
      }
    }
    res.json({ message: 'Backfill complete', results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const apiRouter = express.Router();
apiRouter.use(healthRoutes);
apiRouter.use(registrationRoutes);
apiRouter.use(financeRoutes);
apiRouter.use(hrRoutes);
apiRouter.use(adminRoutes);
apiRouter.use(authRoutes);
apiRouter.use(employeeRoutes);
apiRouter.use(goalRoutes);
apiRouter.use(taskRoutes);
apiRouter.use(leaveRoutes);
apiRouter.use(appraisalRoutes);
apiRouter.use(exReviewRoutes);
apiRouter.use(reportsRoutes);
apiRouter.use(registryRoutes);
apiRouter.use(uploadRoutes);
apiRouter.use(activityRoutes);
apiRouter.use(policyRoutes);
apiRouter.use(hubRoutes);
if (env.nodeEnv !== 'production') {
  apiRouter.use(devRoutes);
}

// Mount on /api for local dev and standard setups
app.use('/api', apiRouter);
// Mount on / for reverse proxies (like Nginx) that strip the /api prefix
app.use('/', apiRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
