const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs').promises;
const path = require('path');
const OpenAIService = require('./openaiService');
const { OpenAI } = require('openai'); // Added for OpenRouter
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Added for Gemini

console.log("[whatsappService.js] Required modules imported");

class WhatsAppService {
  constructor(io) {
    console.log("[whatsappService.js] WhatsAppService constructor called");
    this.io = io;
    this.sock = null;
    this.isReady = false;
    this.openaiService = new OpenAIService();
    this.sessionPath = process.env.SESSION_FILE_PATH || './session/baileys-auth';

    console.log("[whatsappService.js] Basic properties initialized");
    this.initializeAIProviders();
  }

  initializeAIProviders() {
    console.log("[whatsappService.js] Initializing AI providers");
    this.aiProvider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
    
    this.openRouterClient = null;
    this.geminiClient = null;
    
    if (this.aiProvider === 'openrouter') {
      console.log("[whatsappService.js] Configuring OpenRouter");
      this.openRouterApiKey = process.env.OPENROUTER_API_KEY;
      this.openRouterModel = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini-2024-07-18';
      if (this.openRouterApiKey) {
        this.openRouterClient = new OpenAI({
          apiKey: this.openRouterApiKey,
          baseURL: 'https://openrouter.ai/api/v1',
        });
        console.log('[whatsappService.js] 🔄 OpenRouter Service configured.');
      } else {
        console.warn('[whatsappService.js] ⚠️ OpenRouter API key not provided.');
      }
    }

    if (this.aiProvider === 'gemini') {
      console.log("[whatsappService.js] Configuring Gemini");
      this.geminiApiKey = process.env.GEMINI_API_KEY;
      if (this.geminiApiKey) {
        this.geminiClient = new GoogleGenerativeAI(this.geminiApiKey).getGenerativeModel({ model: "gemini-2.0-flash" });
        console.log('[whatsappService.js] 🔄 Gemini Service configured.');
      } else {
        console.warn('[whatsappService.js] ⚠️ Gemini API key not provided.');
      }
    }
    console.log(`[whatsappService.js] 🤖 Current AI Provider: ${this.aiProvider}`);
  }

  reloadAIProvider() {
    console.log('[whatsappService.js] 🔄 Reloading AI Provider configuration...');
    
    require('dotenv').config();
    this.initializeAIProviders();
    
    this.io.emit('ai-provider-reloaded', {
      newProvider: this.aiProvider,
      timestamp: new Date(),
      message: `AI Provider switched to ${this.aiProvider}`
    });
    
    console.log(`[whatsappService.js] ✅ AI Provider reloaded successfully: ${this.aiProvider}`);
    return true;
  }

  reloadAutoReplyConfig() {
    console.log('[whatsappService.js] 🔄 Reloading Auto-Reply configuration...');
    
    try {
      this.openaiService.reloadAutoReplyConfig();
      this.io.emit('auto-reply-config-reloaded', {
        timestamp: new Date(),
        message: 'Auto-reply configuration reloaded successfully'
      });
      
      console.log('[whatsappService.js] ✅ Auto-Reply configuration reloaded successfully');
      return true;
    } catch (error) {
      console.error('[whatsappService.js] ❌ Failed to reload auto-reply config:', error);
      return false;
    }
  }

  async initialize() {
    console.log('[whatsappService.js] 🔄 Initializing WhatsApp client with Baileys...');
    
    try {
      console.log("[whatsappService.js] Creating session directory if needed");
      await fs.mkdir(this.sessionPath, { recursive: true });
      
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
      console.log("[whatsappService.js] Multi-file auth state initialized");
      
      const logger = {
        level: 'silent',
        child: () => logger,
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {}
      };
      
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: logger
      });
      console.log("[whatsappService.js] WhatsApp socket created");

      this.setupEventHandlers(saveCreds);
      console.log("[whatsappService.js] Event handlers setup completed");
      
    } catch (error) {
      console.error('[whatsappService.js] ❌ Error initializing WhatsApp client:', error);
      this.io.emit('error', { message: 'Failed to initialize WhatsApp client', error: error.message });
    }
  }

  setupEventHandlers(saveCreds) {
    console.log("[whatsappService.js] Setting up event handlers");
    
    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log('[whatsappService.js] 📱 QR Code received, scan with your phone:');
        qrcode.generate(qr, { small: true });
        this.io.emit('qr-code', qr);
      }
      
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('[whatsappService.js] 📱 Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
        
        this.isReady = false;
        this.io.emit('whatsapp-disconnected', { 
          reason: lastDisconnect?.error?.output?.statusCode,
          shouldReconnect 
        });
        
        if (shouldReconnect) {
          setTimeout(() => {
            this.initialize();
          }, 3000);
        }
      } else if (connection === 'open') {
        console.log('[whatsappService.js] ✅ WhatsApp client is ready!');
        this.isReady = true;
        this.io.emit('whatsapp-ready', { status: 'ready' });
      }
    });

    this.sock.ev.on('creds.update', saveCreds);
    console.log("[whatsappService.js] Credentials update handler set");

    this.sock.ev.on('messages.upsert', async (m) => {
      console.log("[whatsappService.js] New message received");
      const message = m.messages[0];
      if (!message.message || message.key.fromMe) return;
      
      await this.handleMessage(message);
    });
  }

  async handleMessage(message) {
    console.log("[whatsappService.js] Handling incoming message");
    try {
      const messageText = this.extractMessageText(message);
      const senderId = message.key.remoteJid;
      const isGroup = senderId.includes('@g.us');
      const senderNumber = message.key.participant || senderId;
      
      this.io.emit('message-received', {
        from: senderId,
        body: messageText,
        timestamp: new Date(),
        isGroup: isGroup
      });

      if (senderId === 'status@broadcast') {
        console.log("[whatsappService.js] Ignoring status broadcast message");
        return;
      }

      console.log(`[whatsappService.js] 📨 Message from ${senderNumber}: ${messageText}`);

      if (!this.openaiService.shouldAutoReply(isGroup)) {
        console.log(`[whatsappService.js] 🔇 Auto-reply disabled for ${isGroup ? 'group' : 'private'} chat: ${senderNumber}`);
        
        this.io.emit('message-skipped', {
          from: senderId,
          body: messageText,
          timestamp: new Date(),
          isGroup: isGroup,
          reason: isGroup ? 'Group auto-reply disabled' : 'Private auto-reply disabled'
        });
        
        return;
      }

      if (messageText && messageText.trim()) {
        await this.processWithAI(message, messageText, senderNumber, senderId);
      }

    } catch (error) {
      console.error('[whatsappService.js] ❌ Error handling message:', error);
      this.io.emit('error', { message: 'Error handling message', error: error.message });
    }
  }

  extractMessageText(message) {
    console.log("[whatsappService.js] Extracting message text");
    const messageContent = message.message;
    
    if (messageContent.conversation) {
      return messageContent.conversation;
    } else if (messageContent.extendedTextMessage) {
      return messageContent.extendedTextMessage.text;
    } else if (messageContent.imageMessage && messageContent.imageMessage.caption) {
      return messageContent.imageMessage.caption;
    } else if (messageContent.videoMessage && messageContent.videoMessage.caption) {
      return messageContent.videoMessage.caption;
    }
    
    return '';
  }

  async processWithAI(message, messageText, senderNumber, chatId) {
    console.log(`[whatsappService.js] Processing message with ${this.aiProvider} AI`);
    try {
      const isGroup = chatId.includes('@g.us');
      const senderName = senderNumber.replace('@s.whatsapp.net', '');

      if (!this.openaiService.shouldAutoReply(isGroup)) {
        console.log(`[whatsappService.js] 🔇 Auto-reply disabled for ${isGroup ? 'group' : 'private'} chat from ${senderName}`);
        
        this.io.emit('message-received-no-reply', {
          from: chatId,
          message: messageText,
          contact: senderName,
          isGroup: isGroup,
          reason: `Auto-reply disabled for ${isGroup ? 'groups' : 'private chats'}`,
          timestamp: new Date()
        });
        
        return;
      }

      console.log("[whatsappService.js] Sending typing indicator");
      await this.sock.sendPresenceUpdate('composing', chatId);

      let aiResponse;
      console.log(`[whatsappService.js] Using AI provider: ${this.aiProvider}`);

      switch (this.aiProvider) {
        case 'openrouter':
          if (!this.openRouterClient) {
            throw new Error('OpenRouter client not initialized. Check API key.');
          }
          aiResponse = await this.generateOpenRouterResponse(messageText, senderName);
          break;
        case 'gemini':
          if (!this.geminiClient) {
            throw new Error('Gemini client not initialized. Check API key.');
          }
          aiResponse = await this.generateGeminiResponse(messageText, senderName);
          break;
        case 'openai':
        default:
          aiResponse = await this.openaiService.generateResponse(messageText, senderName);
          break;
      }

      if (aiResponse === null) {
        this.io.emit('message-blocked', {
          from: chatId,
          message: messageText,
          contact: senderName,
          timestamp: new Date()
        });
        
        console.log(`[whatsappService.js] 🚫 Message blocked from ${senderName} by ${this.aiProvider}`);
        return;
      }

      const whatsappOptimizedResponse = this.optimizeForWhatsApp(aiResponse);
      console.log("[whatsappService.js] Message optimized for WhatsApp");

      await this.sock.sendMessage(chatId, { text: whatsappOptimizedResponse });
      console.log("[whatsappService.js] Message sent successfully");

      await this.sock.sendPresenceUpdate('available', chatId);

      this.io.emit('ai-response', {
        to: chatId,
        originalMessage: messageText,
        response: whatsappOptimizedResponse,
        provider: this.aiProvider,
        timestamp: new Date()
      });

      console.log(`[whatsappService.js] 🤖 ${this.aiProvider} Response sent to ${senderName}`);

    } catch (error) {
      console.error(`[whatsappService.js] ❌ Error processing with ${this.aiProvider} AI:`, error);
      await this.sock.sendMessage(chatId, { 
        text: 'Maaf, terjadi kesalahan saat memproses pesan Anda dengan AI. Silakan coba lagi nanti.' 
      });
    }
  }

  async generateOpenRouterResponse(text, senderName) {
    console.log("[whatsappService.js] Generating OpenRouter response");
    const blacklistCheck = this.openaiService.isMessageBlacklisted(text);
    if (blacklistCheck.blocked) {
      console.log(`[whatsappService.js] 🚫 Message from ${senderName} blacklisted: ${blacklistCheck.word}`);
      return null;
    }

    try {
      const systemMessageContent = this.openaiService.getSystemPrompt() || "You are a helpful assistant.";
      
      const messages = [
        { role: "system", content: systemMessageContent },
        { role: "user", content: `Message from ${senderName}: ${text}` }
      ];
      
      console.log(`[whatsappService.js] 🔄 Sending to OpenRouter (${this.openRouterModel}): ${text}`);
      const completion = await this.openRouterClient.chat.completions.create({
        model: this.openRouterModel,
        messages: messages,
        max_tokens: 500,
        temperature: 0.7
      });
      
      const responseText = completion.choices[0]?.message?.content?.trim();
      if (!responseText) {
        console.warn('[whatsappService.js] ⚠️ OpenRouter returned an empty response.');
        return 'Maaf, saya tidak bisa memberikan respons saat ini.';
      }
      console.log(`[whatsappService.js] 💬 OpenRouter Response: ${responseText}`);
      return responseText;
    } catch (error) {
      console.error('[whatsappService.js] ❌ Error with OpenRouter API:', error.response ? error.response.data : error.message);
      
      if (error.status === 401) {
        return 'Maaf, OpenRouter API key tidak valid. Silakan periksa konfigurasi.';
      } else if (error.status === 429) {
        return 'Maaf, terlalu banyak permintaan ke OpenRouter. Silakan coba lagi nanti.';
      } else {
        return 'Maaf, terjadi masalah saat menghubungi layanan OpenRouter.';
      }
    }
  }

  async generateGeminiResponse(text, senderName) {
    console.log("[whatsappService.js] Generating Gemini response");
    const blacklistCheck = this.openaiService.isMessageBlacklisted(text);
    if (blacklistCheck.blocked) {
      console.log(`[whatsappService.js] 🚫 Message from ${senderName} blacklisted: ${blacklistCheck.word}`);
      return null;
    }

    try {
      const systemInstruction = this.openaiService.getSystemPrompt() || "You are a helpful assistant.";
      const fullPrompt = `${systemInstruction}\n\nUser (${senderName}): ${text}\n\nAssistant:`;
      
      console.log(`[whatsappService.js] 🔄 Sending to Gemini: ${text}`);
      
      const result = await this.geminiClient.generateContent(fullPrompt);
      const response = await result.response;
      const responseText = response.text()?.trim();

      if (!responseText) {
        console.warn('[whatsappService.js] ⚠️ Gemini returned an empty response.');
        return 'Maaf, saya tidak bisa memberikan respons saat ini.';
      }
      console.log(`[whatsappService.js] 💬 Gemini Response: ${responseText}`);
      return responseText;
    } catch (error) {
      console.error('[whatsappService.js] ❌ Error with Gemini API:', error);
      
      if (error.message?.includes('API_KEY_INVALID')) {
        return 'Maaf, Gemini API key tidak valid. Silakan periksa konfigurasi.';
      } else if (error.message?.includes('QUOTA_EXCEEDED')) {
        return 'Maaf, kuota Gemini API sudah habis. Silakan periksa billing account.';
      } else if (error.message?.includes('SAFETY')) {
        return 'Maaf, pesan Anda tidak dapat diproses karena alasan keamanan.';
      } else {
        return 'Maaf, terjadi masalah saat menghubungi layanan Gemini.';
      }
    }
  }

  optimizeForWhatsApp(text) {
    console.log("[whatsappService.js] Optimizing message for WhatsApp");
    if (!text) return text;

    let optimized = text;

    if (optimized.length > 4000) {
      console.log("[whatsappService.js] Message too long, splitting");
      let breakPoint = optimized.lastIndexOf('.', 4000);
      if (breakPoint === -1) {
        breakPoint = optimized.lastIndexOf(' ', 4000);
      }
      if (breakPoint === -1) {
        breakPoint = 4000;
      }
      
      const firstPart = optimized.substring(0, breakPoint + 1).trim();
      const secondPart = optimized.substring(breakPoint + 1).trim();
      
      optimized = firstPart + '\n\n*[Lanjutan...]*\n\n' + secondPart;
    }

    return optimized.trim();
  }

  async sendMessage(to, message) {
    console.log("[whatsappService.js] Sending message");
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    try {
      const chatId = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      const formattedMessage = this.optimizeForWhatsApp(message);
      
      await this.sock.sendMessage(chatId, { text: formattedMessage });
      
      this.io.emit('message-sent', {
        to: chatId,
        body: formattedMessage,
        timestamp: new Date()
      });

      console.log("[whatsappService.js] Message sent successfully");
      return { success: true, message: 'Message sent successfully' };
    } catch (error) {
      console.error('[whatsappService.js] ❌ Error sending message:', error);
      throw error;
    }
  }

  async getChats() {
    console.log("[whatsappService.js] Getting chats");
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    try {
      console.log('[whatsappService.js] ℹ️ Baileys doesn\'t provide chat list directly.');
      return [];
    } catch (error) {
      console.error('[whatsappService.js] ❌ Error getting chats:', error);
      throw error;
    }
  }

  getStatus() {
    console.log("[whatsappService.js] Getting status");
    return {
      isReady: this.isReady,
      hasClient: !!this.sock
    };
  }

  async destroy() {
    console.log('[whatsappService.js] 🔄 Destroying WhatsApp client...');
    if (this.sock) {
      this.sock.end();
      this.sock = null;
      this.isReady = false;
      this.io.emit('whatsapp-destroyed');
      console.log('[whatsappService.js] ✅ WhatsApp client destroyed');
    }
  }

  async clearSession() {
    console.log('[whatsappService.js] 🔄 Clearing WhatsApp session...');
    try {
      if (this.sock) {
        console.log('[whatsappService.js] 🔄 Destroying existing client...');
        await this.destroy();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      console.log(`[whatsappService.js] 🔍 Checking session directory: ${this.sessionPath}`);
      
      if (await this.directoryExists(this.sessionPath)) {
        console.log('[whatsappService.js] 📂 Session directory found, removing...');
        await this.removeDirectory(this.sessionPath);
        console.log('[whatsappService.js] ✅ Session directory cleared successfully');
        
        this.io.emit('session-cleared', { 
          success: true, 
          message: 'Session cleared successfully' 
        });
        
        return { success: true, message: 'Session cleared successfully' };
      } else {
        console.log('[whatsappService.js] ℹ️ No session directory found');
        this.io.emit('session-cleared', { 
          success: true, 
          message: 'No session found to clear' 
        });
        
        return { success: true, message: 'No session found to clear' };
      }
      
    } catch (error) {
      console.error('[whatsappService.js] ❌ Error clearing session:', error);
      this.io.emit('session-clear-error', { 
        error: error.message 
      });
      return { success: false, message: error.message };
    }
  }

  async directoryExists(dirPath) {
    console.log(`[whatsappService.js] Checking if directory exists: ${dirPath}`);
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  async removeDirectory(dirPath) {
    console.log(`[whatsappService.js] 🗑️ Removing directory: ${dirPath}`);
    try {
      if (fs.rm) {
        await fs.rm(dirPath, { recursive: true, force: true });
      } else {
        await this.removeDirectoryRecursive(dirPath);
      }
      
      console.log(`[whatsappService.js] ✅ Directory removed: ${dirPath}`);
    } catch (error) {
      console.error(`[whatsappService.js] ❌ Error removing directory ${dirPath}:`, error);
      
      if (error.code === 'EBUSY' || error.code === 'ENOTEMPTY') {
        console.log('[whatsappService.js] 🔄 Retrying with alternative method...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          await this.removeDirectoryRecursive(dirPath);
          console.log(`[whatsappService.js] ✅ Directory removed with alternative method: ${dirPath}`);
        } catch (retryError) {
          console.error('[whatsappService.js] ❌ Alternative method also failed:', retryError);
          throw retryError;
        }
      } else {
        throw error;
      }
    }
  }

  async removeDirectoryRecursive(dirPath) {
    console.log(`[whatsappService.js] Removing directory recursively: ${dirPath}`);
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        
        try {
          const stats = await fs.stat(filePath);
          
          if (stats.isDirectory()) {
            await this.removeDirectoryRecursive(filePath);
          } else {
            await fs.unlink(filePath);
          }
        } catch (fileError) {
          console.warn(`[whatsappService.js] ⚠️ Could not remove ${filePath}:`, fileError.message);
        }
      }
      
      await fs.rmdir(dirPath);
    } catch (error) {
      console.error(`[whatsappService.js] ❌ Error in removeDirectoryRecursive for ${dirPath}:`, error);
      throw error;
    }
  }
}

console.log("[whatsappService.js] WhatsAppService class defined");
module.exports = WhatsAppService;
