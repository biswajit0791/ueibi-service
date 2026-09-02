import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
console.log('Connection string host:', connectionString.match(/@([^:]+):/)?.[1]);
console.log('Connection string port:', connectionString.match(/:(\d+)\//)?.[1]);

const client = new Client({ connectionString });

try {
  await client.connect();
  console.log('SUCCESS: Connected to PostgreSQL!');
  const res = await client.query('SELECT version()');
  console.log('PostgreSQL version:', res.rows[0].version);
  await client.end();
} catch (err) {
  console.error('FAILED to connect:', err.message);
  if (err.code) console.error('Error code:', err.code);
  process.exit(1);
}
