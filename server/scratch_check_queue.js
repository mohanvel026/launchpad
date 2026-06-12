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
  const jobCounts = await buildQueue.getJobCounts();
  console.log('Job counts:', jobCounts);
  
  const waiting = await buildQueue.getJobs(['waiting']);
  console.log('Waiting jobs count:', waiting.length);
  for (const j of waiting) {
    console.log(`- Job ID: ${j.id}, Data:`, j.data);
  }

  const active = await buildQueue.getJobs(['active']);
  console.log('Active jobs count:', active.length);
  for (const j of active) {
    console.log(`- Job ID: ${j.id}, Data:`, j.data);
  }

  const failed = await buildQueue.getJobs(['failed']);
  console.log('Failed jobs count:', failed.length);

  process.exit(0);
}

run().catch(console.error);
