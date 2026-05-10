const { Server } = require('socket.io');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin:  process.env.CLIENT_URL,
      methods: ['GET', 'POST'],
    },
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

    socket.on('disconnect', () => {
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