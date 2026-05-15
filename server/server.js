require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const app  = require('./src/app');
const { initSocket }                      = require('./src/sockets/logs.socket');
const { startMetricsWorker }              = require('./src/workers/metrics.worker');
const { handleWsUpgrade }                 = require('./src/middleware/projectProxy.middleware');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

initSocket(server);
startMetricsWorker();

// Forward WebSocket upgrades for proxied project subdomains
server.on('upgrade', (req, socket, head) => handleWsUpgrade(req, socket, head));

server.listen(PORT, () => {
  console.log(`🚀 LaunchPad server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = server;