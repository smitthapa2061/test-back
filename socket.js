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
      origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or Postman)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
          'http://localhost:3001',
          'http://localhost:3000',
          'http://localhost:1420',
          'tauri://localhost',
          'https://scoresync-v1.vercel.app',
        ];
        
        // Check if origin is allowed OR if it's a Vercel preview deployment
        if (allowedOrigins.includes(origin) || origin.includes('.vercel.app')) {
          callback(null, true);
        } else {
          console.warn('⚠️ Socket.IO CORS blocked origin:', origin);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST'],
    }
  });
  console.log('✅ Socket.IO initialized with CORS');
  return ioInstance;
}

function getSocket() {
  if (!ioInstance) {
    throw new Error('Socket.IO not initialized. Call initializeSocket first.');
  }
  return ioInstance;
}

module.exports = { initializeSocket, getSocket };