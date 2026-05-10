require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const app  = require('./src/app');
const { initSocket }          = require('./src/sockets/logs.socket');
const { startMetricsWorker }  = require('./src/workers/metrics.worker');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

initSocket(server);
startMetricsWorker();

server.listen(PORT, () => {
  console.log(`🚀 LaunchPad server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = server;