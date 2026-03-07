// Railway Server Proxy for XP System

const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== CONFIGURATION ====================

const SECRET_KEY = "uhj498534u8r9305ur9GIJRGOEUHFE8949gj30";  // Muss gleich sein!

// Pending commands queue (wartet auf Roblox response)
const pendingCommands = new Map();

// ==================== INFO ENDPOINT ====================

app.get('/', (req, res) => {
    res.json({
        service: 'Roblox XP System - Railway Proxy',
        status: 'running',
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
    
    // Warte auf Roblox response (max 30 Sekunden)
    const timeout = 30000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        const cmd = pendingCommands.get(command_id);
        
        if (cmd.status === 'completed') {
            // Success!
            pendingCommands.delete(command_id);
            
            return res.json({
                success: true,
                username: cmd.result.username,
                organization: cmd.result.organization,
                previous_xp: cmd.result.previous_xp,
                new_xp: cmd.result.new_xp,
                xp_change: cmd.result.xp_change
            });
        }
        
        if (cmd.status === 'failed') {
            // Failed
            pendingCommands.delete(command_id);
            
            return res.status(500).json({
                success: false,
                error: cmd.error || 'Unknown error in Roblox'
            });
        }
        
        // Warte 100ms
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Timeout
    pendingCommands.delete(command_id);
    console.log(`[COMMAND] ⏱️ Timeout for command ${command_id}`);
    
    return res.status(504).json({
        success: false,
        error: 'Timeout - Roblox game server did not respond. Is the game running?'
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

// Roblox reported Command result
app.post('/report_result', (req, res) => {
    console.log('[RESULT] Received from Roblox:', req.body);
    
    const { command_id, success, username, organization, previous_xp, new_xp, xp_change, error, secret_key } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[RESULT] ❌ Unauthorized');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const cmd = pendingCommands.get(command_id);
    
    if (!cmd) {
        console.log(`[RESULT] ⚠️ Unknown command: ${command_id}`);
        return res.status(404).json({ error: 'Command not found' });
    }
    
    if (success) {
        cmd.status = 'completed';
        cmd.result = {
            username,
            organization,
            previous_xp,
            new_xp,
            xp_change
        };
        console.log(`[RESULT] ✅ Command ${command_id} completed successfully`);
    } else {
        cmd.status = 'failed';
        cmd.error = error || 'Unknown error';
        console.log(`[RESULT] ❌ Command ${command_id} failed: ${cmd.error}`);
    }
    
    res.json({ received: true });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Railway XP Proxy Server running on port ${PORT}`);
    console.log(`📡 Ready to receive commands from Discord Bot`);
    console.log(`🎮 Ready to serve commands to Roblox game`);
});
