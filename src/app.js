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
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

app.use('/api', healthRoutes);
app.use('/api', registrationRoutes);
app.use('/api', financeRoutes);
app.use('/api', hrRoutes);
app.use('/api', adminRoutes);
if (env.nodeEnv !== 'production') {
  app.use('/api', devRoutes);
}

app.use(notFound);
app.use(errorHandler);

export default app;
