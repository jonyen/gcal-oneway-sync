import http from 'http';
import { main } from './onewaySync.js';

const PORT = process.env.PORT || 8080;

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
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'success', message: 'Calendar sync completed', timestamp: new Date().toISOString() }));
    } catch (error) {
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