// Railway Server Proxy for XP System with Rate Limiting
// Prevents HTTP 429 errors by limiting request rates

const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== CONFIGURATION ====================

const SECRET_KEY = "uhj498534u8r9305ur9GIJRGOEUHFE8949gj30";

// Pending commands queue
const pendingCommands = new Map();

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 12; // 12 requests per minute = 1 every 5 seconds

// ==================== RATE LIMITING MIDDLEWARE ====================

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, []);
    }
    
    const requests = rateLimitMap.get(ip);
    
    // Remove old requests outside the window
    const recentRequests = requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
        console.log(`[RATE LIMIT] ⚠️ IP ${ip} exceeded rate limit`);
        return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please wait before making more requests.',
            retry_after: Math.ceil((recentRequests[0] + RATE_LIMIT_WINDOW - now) / 1000)
        });
    }
    
    recentRequests.push(now);
    rateLimitMap.set(ip, recentRequests);
    
    next();
}

// Clean up old rate limit data every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, requests] of rateLimitMap.entries()) {
        const recentRequests = requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
        if (recentRequests.length === 0) {
            rateLimitMap.delete(ip);
        } else {
            rateLimitMap.set(ip, recentRequests);
        }
    }
}, 300000);

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
        pending_commands: pendingCommands.size,
        rate_limit: {
            window: `${RATE_LIMIT_WINDOW / 1000} seconds`,
            max_requests: MAX_REQUESTS_PER_WINDOW
        }
    });
});

// ==================== DISCORD BOT ENDPOINTS ====================

app.post('/execute_xp_command', async (req, res) => {
    console.log('[COMMAND] Request from Discord:', req.body);
    
    const { username, organization, xp_change, secret_key, command_id, user_id } = req.body;
    
    if (secret_key !== SECRET_KEY) {
        console.log('[COMMAND] ❌ Unauthorized');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!username || !organization || xp_change === undefined || !command_id) {
        return res.status(400).json({ error: 'Missing parameters (need username, organization, xp_change, command_id)' });
    }
    
    const command = {
        command_id,
        username,
        organization,
        xp_change,
        user_id: user_id || null,
        timestamp: Date.now()
    };
    
    pendingCommands.set(command_id, {
        command,
        result: null,
        timestamp: Date.now()
    });
    
    console.log(`[COMMAND] ✅ Queued: ${command_id}`);
    
    const timeout = 30000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        const entry = pendingCommands.get(command_id);
        
        if (entry && entry.result) {
            pendingCommands.delete(command_id);
            console.log(`[COMMAND] ✅ Result received: ${command_id}`);
            return res.json(entry.result);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`[COMMAND] ⏱️ Timeout: ${command_id}`);
    return res.status(504).json({ 
        error: 'Timeout', 
        message: 'Roblox game did not respond in time'
    });
});

// ==================== ROBLOX GAME ENDPOINTS ====================

app.post('/poll_commands', rateLimit, (req, res) => {
    const { secret_key } = req.body;
    
    if (secret_key !== SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const commands = [];
    const now = Date.now();
    const maxAge = 60000;
    
    for (const [command_id, entry] of pendingCommands.entries()) {
        if (now - entry.timestamp > maxAge) {
            pendingCommands.delete(command_id);
            continue;
        }
        
        if (!entry.result) {
            commands.push(entry.command);
        }
    }
    
    res.json({ commands });
});

app.post('/report_result', rateLimit, (req, res) => {
    const { command_id, success, username, organization, previous_xp, new_xp, xp_change, error, secret_key } = req.body;
    
    if (secret_key !== SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!command_id) {
        return res.status(400).json({ error: 'Missing command_id' });
    }
    
    const entry = pendingCommands.get(command_id);
    if (!entry) {
        console.log(`[RESULT] ⚠️ Command not found: ${command_id}`);
        return res.json({ status: 'command_not_found' });
    }
    
    entry.result = {
        success,
        username,
        organization,
        previous_xp,
        new_xp,
        xp_change,
        error: error || null
    };
    
    console.log(`[RESULT] ✅ Stored result for ${command_id}: ${success ? 'success' : 'failed'}`);
    res.json({ status: 'ok' });
});

// ==================== CLEANUP ====================

setInterval(() => {
    const now = Date.now();
    const maxAge = 120000;
    
    for (const [command_id, entry] of pendingCommands.entries()) {
        if (now - entry.timestamp > maxAge) {
            console.log(`[CLEANUP] Removing old command: ${command_id}`);
            pendingCommands.delete(command_id);
        }
    }
}, 60000);

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Railway XP Proxy running on port ${PORT}`);
    console.log(`✅ Rate limiting: ${MAX_REQUESTS_PER_WINDOW} requests per ${RATE_LIMIT_WINDOW / 1000} seconds`);
});
