const { execSync } = require('child_process');

const containerId = '6d9ebeace0dbb50781c44398ed5ab59d3249750eb7370f4828a06abc274c67ac';

try {
  const inspectOut = execSync(`docker inspect -f "{{.State.Status}}" ${containerId}`, { stdio: 'pipe', timeout: 3000 }).toString().trim();
  console.log('Success! Status:', inspectOut);
} catch (e) {
  console.error('Failed to run inspect!');
  console.error('Message:', e.message);
  console.error('Stderr:', e.stderr ? e.stderr.toString() : 'none');
}
