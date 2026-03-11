// Railway Server Proxy for XP System + Cmdr Integration
// Receives commands from Discord Bot, forwards to Roblox game

const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== CONFIGURATION ====================

const SECRET_KEY = "uhj498534u8r9305ur9GIJRGOEUHFE8949gj30";

// Pending XP commands queue
const pendingCommands = new Map();

// Pending Cmdr commands queue
const pendingCmdrCommands = new Map();

// ==================== INFO ENDPOINT ====================

app.get('/', (req, res) => {
    res.json({
        service: 'Roblox XP System + Cmdr Integration - Railway Proxy',
        status: 'running',
        endpoints: {
            'GET /': 'Server info',
            'POST /execute_xp_command': 'Discord Bot sends XP command',
            'POST /poll_commands': 'Roblox polls for new XP commands',
            'POST /report_result': 'Roblox reports XP command result',
            'POST /execute_cmdr_command': 'Discord Bot sends Cmdr command',
            'POST /poll_cmdr_commands': 'Roblox polls for new Cmdr commands',
            'POST /report_cmdr_result': 'Roblox reports Cmdr command result'
        },
        pending_xp_commands: pendingCommands.size,
        pending_cmdr_commands: pendingCmdrCommands.size
    });
});

// ==================== XP SYSTEM ENDPOINTS ====================

// Discord Bot sends XP Command
app.post('/execute_xp_command', async (req, res) => {
    console.log('[XP COMMAND] Request from Discord:', req.body);
    
    const { username, organization, xp_change, secret_key, command_id, user_id } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[XP COMMAND] ❌ Unauthorized');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!username || !organization || xp_change === undefined || !command_id) {
        return res.status(400).json({ error: 'Missing parameters (need username, organization, xp_change, command_id)' });
    }
    
    // Store command for Roblox (including user_id if provided)
    const commandData = {
        command_id,
        username,
        organization,
        xp_change,
        timestamp: Date.now(),
        status: 'pending'
    };
    
    if (user_id !== undefined && user_id !== null) {
        commandData.user_id = user_id;
    }
    
    pendingCommands.set(command_id, commandData);
    
    console.log(`[XP COMMAND] ✅ Queued command ${command_id} for ${username} (${organization}): ${xp_change > 0 ? '+' : ''}${xp_change} XP${user_id ? ` (user_id: ${user_id})` : ''}`);
    
    // Wait for Roblox response (max 30 seconds)
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
        
        // Wait 100ms
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Timeout
    pendingCommands.delete(command_id);
    console.log(`[XP COMMAND] ⏱️ Timeout for command ${command_id}`);
    
    return res.status(504).json({
        success: false,
        error: 'Timeout - Roblox game server did not respond. Is the game running?'
    });
});

// Roblox polls for new XP Commands
app.post('/poll_commands', (req, res) => {
    const { secret_key, server_id } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const currentTime = Date.now();
    const LOCK_TIMEOUT = 30000; // 30 seconds
    
    // Find pending commands that are not locked or have expired locks
    const commands = [];
    for (const [id, cmd] of pendingCommands.entries()) {
        if (cmd.status === 'pending') {
            // Check if command is locked to another server
            if (cmd.locked_to_server && cmd.locked_to_server !== server_id) {
                // Check if lock has expired
                if (currentTime - cmd.lock_timestamp < LOCK_TIMEOUT) {
                    continue; // Skip - locked to another server
                }
                // Lock expired, we can take it
            }
            
            // Lock this command to this server
            cmd.locked_to_server = server_id;
            cmd.lock_timestamp = currentTime;
            
            const commandToSend = {
                command_id: cmd.command_id,
                username: cmd.username,
                organization: cmd.organization,
                xp_change: cmd.xp_change
            };
            
            if (cmd.user_id !== undefined && cmd.user_id !== null) {
                commandToSend.user_id = cmd.user_id;
            }
            
            commands.push(commandToSend);
        }
    }
    
    if (commands.length > 0) {
        console.log(`[XP POLL] Sending ${commands.length} pending command(s) to server ${server_id || 'unknown'}`);
    }
    
    res.json({ commands });
});

// Roblox reports XP Command result
app.post('/report_result', (req, res) => {
    console.log('[XP RESULT] Received from Roblox:', req.body);
    
    const { command_id, success, username, organization, previous_xp, new_xp, xp_change, error, secret_key } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[XP RESULT] ❌ Unauthorized');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const cmd = pendingCommands.get(command_id);
    
    if (!cmd) {
        console.log(`[XP RESULT] ⚠️ Unknown command: ${command_id}`);
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
        console.log(`[XP RESULT] ✅ Command ${command_id} completed successfully`);
    } else {
        cmd.status = 'failed';
        cmd.error = error || 'Unknown error';
        console.log(`[XP RESULT] ❌ Command ${command_id} failed: ${cmd.error}`);
    }
    
    res.json({ received: true });
});

// ==================== CMDR INTEGRATION ENDPOINTS ====================

// Discord Bot sends Cmdr Command
app.post('/execute_cmdr_command', async (req, res) => {
    console.log('[CMDR COMMAND] Request from Discord:', req.body);
    
    const { command_type, target_username, args, moderator_id, moderator_name, secret_key, command_id } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[CMDR COMMAND] ❌ Unauthorized');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!command_type || !command_id) {
        return res.status(400).json({ error: 'Missing parameters (need command_type, command_id)' });
    }
    
    // Store Cmdr command for Roblox
    const commandData = {
        command_id,
        command_type,
        target_username: target_username || '',
        args: args || [],
        moderator_id: moderator_id || 'unknown',
        moderator_name: moderator_name || 'Unknown',
        timestamp: Date.now(),
        status: 'pending'
    };
    
    pendingCmdrCommands.set(command_id, commandData);
    
    console.log(`[CMDR COMMAND] ✅ Queued command ${command_id}: ${command_type} ${target_username || ''} [${args ? args.join(', ') : ''}]`);
    
    // Wait for Roblox response (max 30 seconds)
    const timeout = 30000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        const cmd = pendingCmdrCommands.get(command_id);
        
        if (cmd.status === 'completed') {
            // Success!
            pendingCmdrCommands.delete(command_id);
            
            return res.json({
                success: true,
                message: cmd.result.message || 'Command executed successfully',
                command_type: command_type,
                target: target_username
            });
        }
        
        if (cmd.status === 'failed') {
            // Failed
            pendingCmdrCommands.delete(command_id);
            
            return res.status(500).json({
                success: false,
                error: cmd.error || 'Unknown error in Roblox'
            });
        }
        
        // Wait 100ms
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Timeout
    pendingCmdrCommands.delete(command_id);
    console.log(`[CMDR COMMAND] ⏱️ Timeout for command ${command_id}`);
    
    return res.status(504).json({
        success: false,
        error: 'Timeout - Roblox game server did not respond. Is the game running?'
    });
});

// Roblox polls for new Cmdr Commands
app.post('/poll_cmdr_commands', (req, res) => {
    const { secret_key, server_id } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const currentTime = Date.now();
    const LOCK_TIMEOUT = 30000; // 30 seconds
    
    // Find pending Cmdr commands
    const commands = [];
    for (const [id, cmd] of pendingCmdrCommands.entries()) {
        if (cmd.status === 'pending') {
            // Check if command is locked to another server
            if (cmd.locked_to_server && cmd.locked_to_server !== server_id) {
                // Check if lock has expired
                if (currentTime - cmd.lock_timestamp < LOCK_TIMEOUT) {
                    continue; // Skip - locked to another server
                }
            }
            
            // Lock this command to this server
            cmd.locked_to_server = server_id;
            cmd.lock_timestamp = currentTime;
            
            commands.push({
                command_id: cmd.command_id,
                command_type: cmd.command_type,
                target_username: cmd.target_username,
                args: cmd.args,
                moderator_id: cmd.moderator_id,
                moderator_name: cmd.moderator_name
            });
        }
    }
    
    if (commands.length > 0) {
        console.log(`[CMDR POLL] Sending ${commands.length} pending Cmdr command(s) to server ${server_id || 'unknown'}`);
    }
    
    res.json({ commands });
});

// Roblox reports Cmdr Command result
app.post('/report_cmdr_result', (req, res) => {
    console.log('[CMDR RESULT] Received from Roblox:', req.body);
    
    const { command_id, success, message, error, secret_key } = req.body;
    
    // Check secret key
    if (secret_key !== SECRET_KEY) {
        console.log('[CMDR RESULT] ❌ Unauthorized');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const cmd = pendingCmdrCommands.get(command_id);
    
    if (!cmd) {
        console.log(`[CMDR RESULT] ⚠️ Unknown command: ${command_id}`);
        return res.status(404).json({ error: 'Command not found' });
    }
    
    if (success) {
        cmd.status = 'completed';
        cmd.result = {
            message: message || 'Command executed'
        };
        console.log(`[CMDR RESULT] ✅ Command ${command_id} completed: ${message || 'success'}`);
    } else {
        cmd.status = 'failed';
        cmd.error = error || 'Unknown error';
        console.log(`[CMDR RESULT] ❌ Command ${command_id} failed: ${cmd.error}`);
    }
    
    res.json({ received: true });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Railway Proxy Server running on port ${PORT}`);
    console.log(`📡 XP System ready`);
    console.log(`🎮 Cmdr Integration ready`);
    console.log(`🚀 Ready to receive commands from Discord Bot`);
});
