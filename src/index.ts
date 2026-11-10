#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AemClient } from './aem.js';
import { createServer } from './server.js';

try {
  await createServer(new AemClient()).connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to start AEM MCP.');
  process.exitCode = 1;
}
