// socket.js

let ioInstance = null;

function initializeSocket(server) {
  if (ioInstance) {
    console.warn('Socket.IO is already initialized.');
    return ioInstance;
  }
  const { Server } = require('socket.io');
  ioInstance = new Server(server, {
   cors: {
    origin: ['http://localhost:3001', 'http://localhost:3000'],
    credentials: true,
  }
  });
  console.log('Socket.IO initialized.');
  return ioInstance;
}

function getSocket() {
  if (!ioInstance) {
    throw new Error('Socket.IO not initialized. Call initializeSocket first.');
  }
  return ioInstance;
}

module.exports = { initializeSocket, getSocket };