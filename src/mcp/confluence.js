const logger = require('../utils/logger');

const SKILL = 'mcp:confluence';

async function getMCPClient() {
  const url = process.env.CONFLUENCE_MCP_URL;
  const token = process.env.CONFLUENCE_ACCESS_TOKEN;
  if (!url || !token) throw new Error('Confluence MCP not configured');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'jarvis-confluence', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function searchPages(query) {
  logger.info('Searching Confluence', { skill: SKILL, query });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'searchConfluenceUsingCql',
    arguments: { cql: `text ~ "${query}" ORDER BY lastmodified DESC`, limit: 10 },
  });
  await client.close();
  return result.content;
}

async function healthCheck() {
  try {
    const client = await getMCPClient();
    await client.close();
    return 'connected';
  } catch (e) {
    logger.debug('Confluence health check failed', { skill: SKILL, error: e.message });
    return 'disconnected';
  }
}

module.exports = { searchPages, healthCheck };
