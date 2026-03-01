// ==================== XP Bridge Server - PROXY MODE ====================
// Discord Bot ↔ Railway (Proxy) ↔ Roblox (Source of Truth)
// 
// Flow:
// 1. Discord: /add_xp username:Player amount:100
// 2. Railway: Empfängt Command, leitet zu Roblox weiter
// 3. Roblox: Ändert XP, antwortet Success/Fail
// 4. Railway: Gibt Result zurück an Discord
// 5. Discord: Zeigt Success/Fail Message

const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== CONFIGURATION ====================

const SECRET_KEY = "uhj498534u8r9305ur9GIJRGOEUHFE8949gj30";  // Muss gleich sein!

// Pending commands queue (wartet auf Roblox response)
const pendingCommands = new Map();

// Track last poll time to know if game server is online
let lastPollTime = 0; // Start at 0 - will be set on first poll
const POLL_TIMEOUT = 10000; // 10 seconds - if no poll in this time, server is offline

// ==================== SERVER STATUS ====================

function isGameServerOnline() {
    // If never polled, server is offline
    if (lastPollTime === 0) {
        return false;
    }
    
    const timeSinceLastPoll = Date.now() - lastPollTime;
    const isOnline = timeSinceLastPoll < POLL_TIMEOUT;
    
    // Log for debugging
    if (!isOnline) {
        console.log(`[SERVER] Offline (last poll: ${Math.floor(timeSinceLastPoll / 1000)}s ago)`);
    }
    
    return isOnline;
}

// ==================== HEALTH CHECKS ====================

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: Date.now() });
});

app.get('/', (req, res) => {
    res.status(200).json({
        status: 'running',
        service: 'Discord-Roblox XP Bridge (Proxy Mode)',
        version: '2.0.0',
        mode: 'proxy',
        endpoints: {
            'GET /': 'Server info',
            'POST /execute_xp_command': 'Discord Bot sends command',
            'POST /poll_commands': 'Roblox polls for new commands',
            'POST /report_result': 'Roblox reports command result'
        },
        pending_commands: pendingCommands.size
    });
});

// ==================== DISCORD BOT ENDPOINTS ====================

// Discord Bot sendet XP Command
app.post('/execute_xp_command', async (req, res) => {
    console.log('[COMMAND] Request from Discord:', req.body);
    
    const { username, organization, xp_change, secret_key, command_id } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[COMMAND] ❌ Unauthorized');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!username || !organization || xp_change === undefined || !command_id) {
        return res.status(400).json({ error: 'Missing parameters (need username, organization, xp_change, command_id)' });
    }
    
    // Speichere Command für Roblox
    pendingCommands.set(command_id, {
        command_id,
        username,
        organization,
        xp_change,
        timestamp: Date.now(),
        status: 'pending'
    });
    
    console.log(`[COMMAND] ✅ Queued command ${command_id} for ${username} (${organization}): ${xp_change > 0 ? '+' : ''}${xp_change} XP`);
    
    // Wait for Roblox response (max 30 seconds)
    const timeout = 30000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        const cmd = pendingCommands.get(command_id);
        
        if (!cmd) {
            // Command was deleted (shouldn't happen)
            console.log(`[COMMAND] ⚠️ Command ${command_id} disappeared from queue`);
            break;
        }
        
        if (cmd.status === 'completed') {
            // Success!
            pendingCommands.delete(command_id);
            
            console.log(`[COMMAND] ✅ Command ${command_id} completed successfully`);
            
            return res.json({
                success: true,
                username: cmd.result.username,
                organization: cmd.result.organization,
                previous_xp: cmd.result.previous_xp,
                new_xp: cmd.result.new_xp,
                xp_change: cmd.result.xp_change,
                queued: false
            });
        }
        
        if (cmd.status === 'failed') {
            // Failed
            pendingCommands.delete(command_id);
            
            console.log(`[COMMAND] ❌ Command ${command_id} failed: ${cmd.error}`);
            
            return res.status(500).json({
                success: false,
                error: cmd.error || 'Unknown error in Roblox'
            });
        }
        
        // Wait 100ms before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Timeout after 30 seconds
    pendingCommands.delete(command_id);
    console.log(`[COMMAND] ⏱️ Timeout for command ${command_id} - no response from Roblox`);
    
    return res.status(504).json({
        success: false,
        error: 'Timeout - Roblox game server did not respond. Is the game running and is a player online?'
    });
});

// ==================== ROBLOX GAME ENDPOINTS ====================

// Roblox pollt für neue Commands
app.post('/poll_commands', (req, res) => {
    const { secret_key } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Update last poll time - server is online!
    lastPollTime = Date.now();
    
    // Finde pending commands
    const commands = [];
    for (const [id, cmd] of pendingCommands.entries()) {
        if (cmd.status === 'pending') {
            commands.push({
                command_id: cmd.command_id,
                username: cmd.username,
                organization: cmd.organization,
                xp_change: cmd.xp_change
            });
        }
    }
    
    if (commands.length > 0) {
        console.log(`[POLL] Sending ${commands.length} pending commands to Roblox`);
    }
    
    res.json({ commands });
});

// Roblox meldet Command Result zurück
app.post('/report_result', (req, res) => {
    console.log('[RESULT] From Roblox:', req.body);
    
    const { command_id, success, username, organization, previous_xp, new_xp, xp_change, error, secret_key } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[RESULT] ❌ Unauthorized');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!command_id) {
        return res.status(400).json({ error: 'Missing command_id' });
    }
    
    const cmd = pendingCommands.get(command_id);
    if (!cmd) {
        console.log(`[RESULT] ⚠️ Command ${command_id} not found (maybe timeout)`);
        return res.json({ acknowledged: true });
    }
    
    if (success) {
        cmd.status = 'completed';
        cmd.result = { username, organization, previous_xp, new_xp, xp_change };
        console.log(`[RESULT] ✅ Command ${command_id} succeeded: ${username} (${organization}) ${previous_xp} → ${new_xp}`);
    } else {
        cmd.status = 'failed';
        cmd.error = error;
        console.log(`[RESULT] ❌ Command ${command_id} failed: ${error}`);
    }
    
    res.json({ acknowledged: true });
});

// ==================== STATS ====================

app.get('/stats', (req, res) => {
    const pending = [];
    const completed = [];
    const failed = [];
    
    for (const [id, cmd] of pendingCommands.entries()) {
        if (cmd.status === 'pending') pending.push(id);
        if (cmd.status === 'completed') completed.push(id);
        if (cmd.status === 'failed') failed.push(id);
    }
    
    res.json({
        pending_commands: pending.length,
        completed_commands: completed.length,
        failed_commands: failed.length,
        total_tracked: pendingCommands.size
    });
});

// ==================== CLEANUP ====================

// Cleanup alte commands (alle 60 Sekunden)
setInterval(() => {
    const now = Date.now();
    const timeout = 60000; // 60 Sekunden
    
    let cleaned = 0;
    for (const [id, cmd] of pendingCommands.entries()) {
        if (now - cmd.timestamp > timeout) {
            pendingCommands.delete(id);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`[CLEANUP] Removed ${cleaned} old commands`);
    }
}, 60000);

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🚀 XP Bridge Server (Proxy Mode) READY!');
    console.log('='.repeat(60));
    console.log(`📡 Listening on port ${PORT}`);
    console.log(`🔑 Secret key: ${SECRET_KEY !== "CHANGE_THIS_SECRET_KEY_123456" ? "✅ CONFIGURED" : "⚠️  DEFAULT"}`);
    console.log(`🎮 Mode: PROXY (Roblox is source of truth)`);
    console.log('='.repeat(60));
    console.log('');
    console.log('📋 Endpoints:');
    console.log('  POST /execute_xp_command - Discord Bot sends command');
    console.log('  POST /poll_commands      - Roblox polls for commands');
    console.log('  POST /report_result      - Roblox reports result');
    console.log('');
    console.log('✅ Ready for Discord ↔ Roblox commands!');
    console.log('='.repeat(60));
});

process.on('SIGTERM', () => {
    console.log('📛 SIGTERM - shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('📛 SIGINT - shutting down...');
    process.exit(0);
});
