import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AemClient } from './aem.js';

export function createServer(client: AemClient) {
  const server = new McpServer({ name: 'aem-mcp', version: '0.1.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const result = async (request: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await request(), null, 2) }] }; }
    catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'AEM request failed.' }] };
    }
  };
  server.registerTool('aem_read_page', {
    description: 'Read a page’s jcr:content as Sling JSON. Requires a page path under an allowed content root.',
    inputSchema: { path: z.string().describe('Page path, e.g. /content/mysite/en'), depth: z.number().int().min(1).max(3).default(1) }, annotations,
  }, ({ path, depth }) => result(() => client.read(path, `/jcr:content.${depth}.json`)));
  server.registerTool('aem_list_children', {
    description: 'Read a content node and its immediate children using Sling JSON. Useful for browsing page trees.',
    inputSchema: { path: z.string().describe('Content root or page path, e.g. /content/mysite') }, annotations,
  }, ({ path }) => result(() => client.read(path, '.1.json')));
  server.registerTool('aem_read_asset', {
    description: 'Read an asset or browse a DAM folder through the AEM Assets HTTP API. Returns metadata and links, not binary data.',
    inputSchema: { path: z.string().describe('DAM asset or folder path, e.g. /content/dam/mysite') }, annotations,
  }, ({ path }) => result(() => client.read(path, '.json', true)));
  const pagination = {
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(10000).default(0),
  };
  server.registerTool('aem_search_components', {
    description: 'Find component instances with an exact sling:resourceType below a page or page-tree path. Returns matching component node paths; use offset to paginate.',
    inputSchema: {
      path: z.string().describe('Page or page-tree root, e.g. /content/mysite/en'),
      resourceType: z.string().min(1).max(500).describe('Exact sling:resourceType, e.g. mysite/components/content/teaser'),
      ...pagination,
    }, annotations,
  }, ({ path, resourceType, limit, offset }) => result(() => client.query(path, {
    property: 'sling:resourceType', 'property.value': resourceType,
  }, limit, offset)));
  server.registerTool('aem_query', {
    description: 'Run a custom AEM Query Builder search scoped to a content path. Supports property, fulltext, type, nodename, boolproperty, daterange, numbered predicates, and nested groups with p.or. Path, pagination and result settings are controlled separately. Returns matching nodes, not necessarily pages.',
    inputSchema: {
      path: z.string().describe('Required content subtree that constrains the whole query'),
      predicates: z.record(z.string(), z.string()).describe('Query Builder predicate map, e.g. {"type":"cq:Page", "1_property":"jcr:content/jcr:title", "1_property.value":"Home"}'),
      ...pagination,
    }, annotations,
  }, ({ path, predicates, limit, offset }) => result(() => client.query(path, predicates, limit, offset)));
  return server;
}
