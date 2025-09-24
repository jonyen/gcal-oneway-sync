import http from 'http';
import { spawn } from 'child_process';
import { main } from './onewaySync.js';
const PORT = process.env.PORT || 8080;
// Helper function to run dedupe script directly
function runDedupe() {
    return new Promise((resolve, reject) => {
        console.log('Running dedupe after sync completion...');
        const child = spawn('node', ['dist/dedupeTarget.js'], { stdio: 'inherit' });
        child.on('close', (code) => {
            if (code === 0) {
                console.log('Dedupe completed successfully');
                resolve();
            }
            else {
                console.error(`Dedupe failed with exit code ${code}`);
                reject(new Error(`Dedupe process exited with code ${code}`));
            }
        });
        child.on('error', (error) => {
            console.error('Failed to start dedupe process:', error);
            reject(error);
        });
    });
}
const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'Calendar sync service is running', timestamp: new Date().toISOString() }));
        return;
    }
    if (req.method === 'POST' && req.url === '/sync') {
        try {
            console.log('Sync triggered via HTTP');
            await main();
            // Run dedupe after successful sync
            try {
                await runDedupe();
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'success', message: 'Calendar sync and dedupe completed', timestamp: new Date().toISOString() }));
            }
            catch (dedupeError) {
                console.error('Dedupe failed:', dedupeError);
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'partial_success', message: 'Calendar sync completed but dedupe failed', syncSuccess: true, dedupeSuccess: false, error: dedupeError instanceof Error ? dedupeError.message : 'Unknown dedupe error', timestamp: new Date().toISOString() }));
            }
        }
        catch (error) {
            console.error('Sync failed:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'Unknown error', timestamp: new Date().toISOString() }));
        }
        return;
    }
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
        return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
});
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('  GET  / - Service status');
    console.log('  POST /sync - Trigger calendar sync');
    console.log('  GET  /health - Health check');
});
// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});
//# sourceMappingURL=server.js.map