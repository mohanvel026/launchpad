const Queue = require('bull');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const buildQueue = new Queue('builds', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
  }
});

async function run() {
  console.log('Resetting Bull Queue...');
  await buildQueue.empty();
  await buildQueue.clean(0, 'active');
  await buildQueue.clean(0, 'failed');
  await buildQueue.clean(0, 'completed');
  await buildQueue.clean(0, 'delayed');
  
  console.log('Queue reset complete.');
  process.exit(0);
}

run().catch(console.error);
