const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

console.log("[server.js] Importing required modules completed");

const whatsappRoutes = require('./routes/whatsapp');
const aiRoutes = require('./routes/ai');
const WhatsAppService = require('./services/whatsappService');

console.log("[server.js] Importing custom modules completed");

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

console.log("[server.js] Express app, HTTP server, and Socket.IO server initialized");

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log("[server.js] Middleware setup completed");

// Initialize WhatsApp service with WebSocket
const whatsappService = new WhatsAppService(io);
console.log("[server.js] WhatsAppService initialized with Socket.IO");

// Routes
app.use('/api/whatsapp', whatsappRoutes(whatsappService));
app.use('/api/ai', aiRoutes(whatsappService)); // Pass whatsappService to aiRoutes
console.log("[server.js] Routes setup completed");

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('[server.js] Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('[server.js] Client disconnected:', socket.id);
  });
  
  socket.on('start-whatsapp', () => {
    console.log('[server.js] Received start-whatsapp event');
    whatsappService.initialize();
  });
  
  socket.on('stop-whatsapp', () => {
    console.log('[server.js] Received stop-whatsapp event');
    whatsappService.destroy();
  });
});

// Basic route
app.get('/', (req, res) => {
  console.log('[server.js] Serving index.html');
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
server.listen(PORT, () => {
  console.log(`[server.js] 🚀 Server running on port ${PORT}`);
  console.log(`[server.js] 📱 WebSocket server ready`);
  console.log(`[server.js] 🌐 Dashboard: http://localhost:${PORT}`);
});

module.exports = { app, server, io };
