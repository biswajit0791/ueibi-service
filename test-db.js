import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
console.log('🔗 Connecting to:', connectionString.replace(/:[^:@]+@/, ':****@'));

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  console.log('✅ Database connected successfully!');
  
  const result = await client.query('SELECT version()');
  console.log('✅ PostgreSQL version:', result.rows[0].version);
  
  // Check if the database exists and is accessible
  const dbResult = await client.query('SELECT current_database(), current_user');
  console.log('✅ Database:', dbResult.rows[0].current_database);
  console.log('✅ User:', dbResult.rows[0].current_user);
} catch (error) {
  console.error('❌ Database connection FAILED!');
  console.error('   Error:', error.message);
  
  if (error.code === 'ECONNREFUSED') {
    console.error('   → PostgreSQL server is not running on the specified host/port.');
    console.error('   → Make sure PostgreSQL is installed and running.');
  } else if (error.code === '3D000') {
    console.error('   → Database "ueibi_dev" does not exist.');
    console.error('   → Run: CREATE DATABASE ueibi_dev;');
  } else if (error.code === '28P01') {
    console.error('   → Wrong password for user.');
  }
} finally {
  await client.end();
}
