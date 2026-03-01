// ==================== XP Bridge Server ====================
// Connects Discord Bot ↔ Roblox Game
// Deploy this on Glitch.com or any Node.js hosting

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== CONFIGURATION ====================

// !!! WICHTIG: Ändere diese Werte !!!
const SECRET_KEY = "uhj498534u8r9305ur9GIJRGOEUHFE8949gj30";  // Muss gleich sein wie in Discord Bot!
const ROBLOX_UNIVERSE_ID = "YOUR_UNIVERSE_ID";  // Deine Roblox Universe ID (optional)
const ROBLOX_API_KEY = "YOUR_ROBLOX_OPEN_CLOUD_API_KEY";  // Von Creator Hub (optional)

// MessagingService URL (optional - nur wenn du MessagingService verwendest)
const MESSAGING_SERVICE_URL = `https://apis.roblox.com/messaging-service/v1/universes/${ROBLOX_UNIVERSE_ID}/topics/XPUpdates`;

// In-Memory Storage (für Demo - in Production: Database verwenden)
const playerXP = new Map();

// ==================== ENDPOINTS ====================

// Homepage - zeigt dass Server läuft
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'Discord-Roblox XP Bridge',
        version: '1.0.0',
        endpoints: {
            'POST /get_xp': 'Get current XP for a player',
            'POST /update_xp': 'Update player XP',
            'POST /report_xp': 'Roblox game reports player XP',
            'GET /stats': 'Server statistics'
        },
        players_tracked: playerXP.size
    });
});

// POST /get_xp - Discord Bot ruft current XP ab
app.post('/get_xp', (req, res) => {
    console.log('[GET XP] Request:', req.body);
    
    const { username, secret_key } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[GET XP] ❌ Unauthorized - wrong secret key');
        return res.status(401).json({ error: 'Unauthorized - invalid secret key' });
    }
    
    if (!username) {
        return res.status(400).json({ error: 'Missing username parameter' });
    }
    
    // Get XP from storage
    const xp = playerXP.get(username.toLowerCase()) || 0;
    
    console.log(`[GET XP] ✅ ${username}: ${xp} XP`);
    
    res.json({
        username: username,
        xp: xp
    });
});

// POST /update_xp - Discord Bot sendet XP update
app.post('/update_xp', async (req, res) => {
    console.log('[UPDATE XP] Request:', req.body);
    
    const { username, xp_change, secret_key } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[UPDATE XP] ❌ Unauthorized - wrong secret key');
        return res.status(401).json({ error: 'Unauthorized - invalid secret key' });
    }
    
    if (!username || xp_change === undefined) {
        return res.status(400).json({ error: 'Missing username or xp_change parameter' });
    }
    
    // Calculate new XP
    const currentXP = playerXP.get(username.toLowerCase()) || 0;
    const newXP = Math.max(0, currentXP + xp_change);  // Don't go below 0
    
    // Update storage
    playerXP.set(username.toLowerCase(), newXP);
    
    console.log(`[UPDATE XP] ✅ ${username}: ${currentXP} → ${newXP} (${xp_change > 0 ? '+' : ''}${xp_change})`);
    
    // Optional: Send to Roblox via MessagingService
    try {
        if (ROBLOX_API_KEY !== "YOUR_ROBLOX_OPEN_CLOUD_API_KEY" && ROBLOX_UNIVERSE_ID !== "YOUR_UNIVERSE_ID") {
            await axios.post(
                MESSAGING_SERVICE_URL,
                {
                    message: JSON.stringify({
                        username: username,
                        xp_change: xp_change,
                        new_xp: newXP
                    })
                },
                {
                    headers: {
                        'x-api-key': ROBLOX_API_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`[UPDATE XP] 📡 Sent to Roblox MessagingService`);
        } else {
            console.log(`[UPDATE XP] ⚠️  MessagingService skipped (not configured)`);
        }
    } catch (error) {
        console.error('[UPDATE XP] ❌ MessagingService error:', error.message);
        // Continue anyway - XP is already updated in storage
    }
    
    res.json({
        username: username,
        new_xp: newXP,
        xp_change: xp_change,
        success: true
    });
});

// POST /report_xp - Roblox Game meldet current XP zurück
app.post('/report_xp', (req, res) => {
    console.log('[REPORT XP] Request:', req.body);
    
    const { username, xp, secret_key } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[REPORT XP] ❌ Unauthorized - wrong secret key');
        return res.status(401).json({ error: 'Unauthorized - invalid secret key' });
    }
    
    if (!username || xp === undefined) {
        return res.status(400).json({ error: 'Missing username or xp parameter' });
    }
    
    // Update storage with XP reported by Roblox
    const oldXP = playerXP.get(username.toLowerCase()) || 0;
    playerXP.set(username.toLowerCase(), xp);
    
    console.log(`[REPORT XP] ✅ ${username}: ${xp} XP (reported by Roblox, was ${oldXP})`);
    
    res.json({ 
        success: true,
        username: username,
        xp: xp
    });
});

// GET /stats - Server Statistiken
app.get('/stats', (req, res) => {
    const players = Array.from(playerXP.entries()).map(([username, xp]) => ({
        username,
        xp
    }));
    
    // Sort by XP (highest first)
    players.sort((a, b) => b.xp - a.xp);
    
    const totalXP = players.reduce((sum, p) => sum + p.xp, 0);
    
    res.json({
        total_players: playerXP.size,
        total_xp: totalXP,
        average_xp: playerXP.size > 0 ? Math.round(totalXP / playerXP.size) : 0,
        top_players: players.slice(0, 10),
        all_players: players  // For debugging
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 XP Bridge Server started!');
    console.log('='.repeat(60));
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔑 Secret key: ${SECRET_KEY !== "CHANGE_THIS_SECRET_KEY_123456" ? "✅ CONFIGURED" : "⚠️  WARNING: Using default key - CHANGE THIS!"}`);
    console.log(`🎮 Roblox Universe ID: ${ROBLOX_UNIVERSE_ID !== "YOUR_UNIVERSE_ID" ? "✅ " + ROBLOX_UNIVERSE_ID : "⚠️  NOT SET (MessagingService disabled)"}`);
    console.log(`🔐 Roblox API Key: ${ROBLOX_API_KEY !== "YOUR_ROBLOX_OPEN_CLOUD_API_KEY" ? "✅ CONFIGURED" : "⚠️  NOT SET (MessagingService disabled)"}`);
    console.log('='.repeat(60));
    console.log('');
    console.log('📋 Available endpoints:');
    console.log('  GET  /          - Server info and status');
    console.log('  POST /get_xp    - Get current XP for a player');
    console.log('  POST /update_xp - Update player XP (add/remove)');
    console.log('  POST /report_xp - Report XP from Roblox game');
    console.log('  GET  /stats     - Server statistics and leaderboard');
    console.log('  GET  /health    - Health check');
    console.log('');
    console.log('✅ Ready to receive requests!');
    console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📛 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('📛 SIGINT received, shutting down gracefully...');
    process.exit(0);
});
