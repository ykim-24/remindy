#!/usr/bin/env node
// Minimal MCP server exposing a `remind` tool that pokes the running remindy pet.
// Add to an MCP client (e.g. Claude) and it can make the pet speak.
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const PORT = process.env.REMINDY_PORT ? Number(process.env.REMINDY_PORT) : 4747;

const server = new Server(
  { name: 'remindy', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'remind',
      description:
        'Make the remindy desktop pet pop a chat bubble with a message. Use for reminders, nudges, or notifications.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Text to show in the bubble' },
          ttl: {
            type: 'number',
            description: 'How long the bubble stays, in ms (default 8000)',
          },
        },
        required: ['message'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'remind') {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }
  const { message, ttl } = req.params.arguments || {};
  const res = await fetch(`http://127.0.0.1:${PORT}/remind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ttl }),
  });
  const data = await res.json();
  return {
    content: [{ type: 'text', text: `Pet said: ${data.sent?.message ?? message}` }],
  };
});

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`remindy MCP server up (talks to http://127.0.0.1:${PORT})`);
})();
