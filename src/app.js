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
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

import { swaggerUiServe, swaggerUiSetup, swaggerSpec } from './config/swagger.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

// Serve uploads static directory
app.use('/uploads', express.static('uploads'));

// Root
app.get('/', (req, res) => res.json({ message: 'UEIBI server running on port 4000' }));

// Swagger API Docs
app.use('/api-docs', swaggerUiServe, swaggerUiSetup);
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

app.use('/api', healthRoutes);
app.use('/api', registrationRoutes);
app.use('/api', financeRoutes);
app.use('/api', hrRoutes);
app.use('/api', adminRoutes);
app.use('/api', authRoutes);
app.use('/api', employeeRoutes);
app.use('/api', goalRoutes);
app.use('/api', taskRoutes);
app.use('/api', leaveRoutes);
app.use('/api', appraisalRoutes);
app.use('/api', exReviewRoutes);
app.use('/api', reportsRoutes);
app.use('/api', registryRoutes);
app.use('/api', uploadRoutes);
app.use('/api', activityRoutes);
if (env.nodeEnv !== 'production') {
  app.use('/api', devRoutes);
}

app.use(notFound);
app.use(errorHandler);

export default app;
