#!/usr/bin/env node

require('dotenv').config();
const Agent = require('./agent');

const agent = new Agent();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[v0] SIGTERM received, shutting down gracefully...');
    await agent.shutdown();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[v0] SIGINT received, shutting down gracefully...');
    await agent.shutdown();
    process.exit(0);
});

// Start the agent
agent.start().catch((error) => {
    console.error('[v0] Fatal error starting agent:', error);
    process.exit(1);
});
