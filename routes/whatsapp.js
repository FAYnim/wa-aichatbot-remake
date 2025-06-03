const express = require('express');
const router = express.Router();

console.log("[whatsapp.js] Router initialized");

module.exports = (whatsappService) => {
  console.log("[whatsapp.js] Creating WhatsApp routes with service");

  // Get WhatsApp status
  router.get('/status', (req, res) => {
    console.log("[whatsapp.js] GET /status request received");
    try {
      const status = whatsappService.getStatus();
      console.log("[whatsapp.js] WhatsApp status retrieved");
      res.json(status);
    } catch (error) {
      console.log("[whatsapp.js] Error getting WhatsApp status:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Start WhatsApp client
  router.post('/start', (req, res) => {
    console.log("[whatsapp.js] POST /start request received");
    try {
      whatsappService.initialize();
      console.log("[whatsapp.js] WhatsApp client initialization started");
      res.json({ message: 'WhatsApp client starting...', success: true });
    } catch (error) {
      console.log("[whatsapp.js] Error starting WhatsApp client:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Stop WhatsApp client
  router.post('/stop', async (req, res) => {
    console.log("[whatsapp.js] POST /stop request received");
    try {
      await whatsappService.destroy();
      console.log("[whatsapp.js] WhatsApp client stopped successfully");
      res.json({ message: 'WhatsApp client stopped', success: true });
    } catch (error) {
      console.log("[whatsapp.js] Error stopping WhatsApp client:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Send message
  router.post('/send', async (req, res) => {
    console.log("[whatsapp.js] POST /send request received");
    try {
      const { to, message } = req.body;
      console.log("[whatsapp.js] Sending message to:", to);
      
      if (!to || !message) {
        console.log("[whatsapp.js] Validation failed - phone number or message missing");
        return res.status(400).json({ error: 'Phone number and message are required' });
      }

      const result = await whatsappService.sendMessage(to, message);
      console.log("[whatsapp.js] Message sent successfully");
      res.json(result);
    } catch (error) {
      console.log("[whatsapp.js] Error sending message:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get chats
  router.get('/chats', async (req, res) => {
    console.log("[whatsapp.js] GET /chats request received");
    try {
      const chats = await whatsappService.getChats();
      console.log("[whatsapp.js] Retrieved chats successfully");
      res.json(chats);
    } catch (error) {
      console.log("[whatsapp.js] Error getting chats:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear WhatsApp session
  router.delete('/session', async (req, res) => {
    console.log("[whatsapp.js] DELETE /session request received");
    try {
      const result = await whatsappService.clearSession();
      console.log("[whatsapp.js] WhatsApp session cleared successfully");
      res.json(result);
    } catch (error) {
      console.log("[whatsapp.js] Error clearing session:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  console.log("[whatsapp.js] All routes configured");
  return router;
};
