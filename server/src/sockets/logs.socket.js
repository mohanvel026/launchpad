const { Server } = require('socket.io');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin:  '*',           // allow any origin — auth is handled by JWT on API routes
      methods: ['GET', 'POST'],
      credentials: false,
    },
    transports: ['websocket', 'polling'],   // polling fallback if WS upgrade fails through nginx
    pingTimeout:  60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Client joins a deployment room to receive live build logs
    socket.on('join:deployment', (deploymentId) => {
      socket.join(`deployment:${deploymentId}`);
      console.log(`Socket ${socket.id} joined deployment:${deploymentId}`);
    });

    // Client joins a metrics room to receive live CPU/RAM stats
    socket.on('join:metrics', (projectId) => {
      socket.join(`metrics:${projectId}`);
      console.log(`Socket ${socket.id} joined metrics:${projectId}`);
    });

    socket.on('leave:metrics', (projectId) => {
      socket.leave(`metrics:${projectId}`);
    });

    // Client joins a runtime-logs room to receive live stdout/stderr of running docker container
    socket.on('join:runtime-logs', async (projectId) => {
      socket.join(`runtime-logs:${projectId}`);
      console.log(`Socket ${socket.id} joined runtime-logs:${projectId}`);
      
      // If there's an existing streaming process for this socket, kill it first
      if (socket.runtimeLogProcess) {
        try { socket.runtimeLogProcess.kill(); } catch {}
        socket.runtimeLogProcess = null;
      }

      try {
        const Project = require('../models/Project.model');
        const project = await Project.findById(projectId);
        if (!project || !project.containerId) {
          socket.emit('runtime-log', { line: `[LaunchPad SRE] No active container found for this project.` });
          return;
        }

        const isWindows = process.platform === 'win32';
        if (isWindows) {
          socket.emit('runtime-log', { line: `[LaunchPad SRE] Docker container logs are only streamable on Linux servers.` });
          return;
        }

        // Spawn docker logs -f --tail 100 <containerId>
        const { spawn } = require('child_process');
        const proc = spawn('docker', ['logs', '-f', '--tail', '100', project.containerId], { stdio: ['ignore', 'pipe', 'pipe'] });
        socket.runtimeLogProcess = proc;

        const handleLogData = (data) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              socket.emit('runtime-log', { line });
            }
          }
        };

        proc.stdout.on('data', handleLogData);
        proc.stderr.on('data', handleLogData);

        proc.on('close', () => {
          socket.emit('runtime-log', { line: `[LaunchPad SRE] Log stream closed.` });
        });

        proc.on('error', (err) => {
          socket.emit('runtime-log', { line: `[LaunchPad SRE] Log stream error: ${err.message}` });
        });

      } catch (err) {
        socket.emit('runtime-log', { line: `[LaunchPad SRE] Error initializing log stream: ${err.message}` });
      }
    });

    socket.on('leave:runtime-logs', () => {
      if (socket.runtimeLogProcess) {
        try { socket.runtimeLogProcess.kill(); } catch {}
        socket.runtimeLogProcess = null;
      }
    });

    socket.on('disconnect', () => {
      if (socket.runtimeLogProcess) {
        try { socket.runtimeLogProcess.kill(); } catch {}
        socket.runtimeLogProcess = null;
      }
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

// Emit a log line to all clients watching a deployment
const emitLog = (deploymentId, line) => {
  try {
    getIO().to(`deployment:${deploymentId}`).emit('log', { line, ts: Date.now() });
  } catch {
    // Socket not ready yet — silent fail
  }
};

// Emit metrics to all clients watching a project
const emitMetrics = (projectId, stats) => {
  try {
    getIO().to(`metrics:${projectId}`).emit('metrics', { projectId, ...stats });
  } catch {}
};

module.exports = { initSocket, getIO, emitLog, emitMetrics };