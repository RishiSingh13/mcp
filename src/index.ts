import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { app, initializeApplication } from './http/app.js';
import { createServer } from './mcp/create-server.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

await initializeApplication();
if (process.argv.includes('--stdio')) {
  const server=createServer(); await server.connect(new StdioServerTransport());
} else {
  app.listen(env.PORT,'0.0.0.0',()=>logger.info({port:env.PORT,mode:env.DEMO_MODE?'demo':'live-capable'},'TripSync HTTP server started'));
}
