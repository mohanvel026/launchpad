const net     = require('net');
const Project = require('../models/Project.model');

// Check if a port is actually free on the OS level
const isPortFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });

// Find the next free port starting from BASE_PORT
// Skips ports already used by live/building projects AND ports in use by the OS
const getNextFreePort = async (basePort = 4000) => {
  // Collect all ports currently assigned to projects
  const usedProjects = await Project.find({
    status: { $in: ['live', 'building'] },
    port:   { $exists: true, $ne: null },
  }).select('port');

  const usedPorts = new Set(usedProjects.map((p) => p.port));

  let port = basePort;
  while (port < 9000) {
    if (!usedPorts.has(port) && (await isPortFree(port))) {
      return port;
    }
    port++;
  }

  throw new Error('No free ports available in range 4000-9000');
};

module.exports = { getNextFreePort, isPortFree };