# ueibi-server

Express + Prisma (MySQL) backend, deployed on Render.

## Local setup

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL` for your local MySQL instance.
2. Install dependencies:
   ```
   npm install
   ```
3. Run migrations against your local database:
   ```
   npm run prisma:migrate
   ```
4. Start the dev server:
   ```
   npm run dev
   ```
5. Check it's alive:
   ```
   curl http://localhost:3000/api/health
   curl http://localhost:3000/api/health/db
   ```

## Deploying to Render

Render doesn't offer a managed MySQL database, only PostgreSQL. This project needs an external
MySQL host (e.g. PlanetScale, Aiven, AWS RDS) — provision one and grab its connection string.

1. Push this project to a Git repo.
2. In Render, create a new Web Service from the repo (or use `render.yaml` via Blueprint).
3. Set the `DATABASE_URL` env var to your external MySQL connection string.
4. Set `CORS_ORIGIN` to your frontend's deployed URL.
5. Render will run `npm install && npx prisma generate` to build, then
   `npx prisma migrate deploy && npm start` to launch, applying pending migrations on each deploy.

## Project structure

```
src/
  app.js              Express app (middleware + route mounting)
  index.js            Entrypoint, starts the HTTP server
  config/env.js        Centralized env var access
  lib/prisma.js        Prisma client singleton
  routes/              Route definitions
  controllers/         Request handlers (added as endpoints grow)
  middleware/           notFound + errorHandler
prisma/
  schema.prisma        Data model (MySQL)
```
