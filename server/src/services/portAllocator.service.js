const net     = require('net');
const Project = require('../models/Project.model');
const Docker  = require('dockerode');

const docker = new Docker(
  process.platform === 'win32'
    ? { host: '127.0.0.1', port: 2375 }
    : { socketPath: '/var/run/docker.sock' }
);

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
// Skips ports already used by projects, previews, active Docker containers, and local sockets
const getNextFreePort = async (basePort = 4000) => {
  const usedPorts = new Set();

  // 1. Gather ports assigned to projects and previews from MongoDB
  const mongoose = require('mongoose');
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const allProjects = await Project.find({}).select('port previews.port');
      for (const p of allProjects) {
        if (p.port) usedPorts.add(p.port);
        if (p.previews) {
          for (const prev of p.previews) {
            if (prev.port) usedPorts.add(prev.port);
          }
        }
      }
    } catch (dbErr) {
      console.warn('[Port Allocator] Failed to fetch project/preview ports from DB:', dbErr.message);
    }
  } else {
    console.warn('[Port Allocator] MongoDB not connected or connection not ready. Skipping DB checks.');
  }

  // 2. Query Docker daemon for currently allocated ports (untracked, temporary, or preview containers)
  try {
    const containers = await docker.listContainers({ all: true });
    for (const container of containers) {
      if (container.Ports) {
        for (const p of container.Ports) {
          if (p.PublicPort) {
            usedPorts.add(Number(p.PublicPort));
          }
        }
      }
    }
  } catch (dockerErr) {
    console.warn('[Port Allocator] Failed to list docker containers for port check:', dockerErr.message);
  }

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