/**
 * A dependency-free MCP server over stdio, so the integration test exercises the real
 * protocol without installing anything: newline-delimited JSON-RPC in, same out.
 */
import process from 'node:process'

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the message back',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Text to echo' } },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'fail',
    description: 'Always reports a tool error',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'mixed',
    description: 'Answers one block of every content kind',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pid',
    description: 'Report the process that serves this session',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

const result = (id, value) => write({ jsonrpc: '2.0', id, result: value })

const failure = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } })

function handle(message) {
  if (message.id === undefined) return
  const { id, method, params } = message
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'workbench-fixture', version: '1.0.0' },
      })
    case 'ping':
      return result(id, {})
    case 'tools/list':
      return result(id, { tools: TOOLS })
    case 'tools/call': {
      if (params?.name === 'echo') {
        return result(id, {
          content: [{ type: 'text', text: `echo: ${params.arguments?.message ?? ''}` }],
          isError: false,
        })
      }
      if (params?.name === 'fail') {
        return result(id, { content: [{ type: 'text', text: 'boom' }], isError: true })
      }
      if (params?.name === 'mixed') {
        return result(id, {
          content: [
            { type: 'text', text: 'first' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
            { type: 'resource', resource: { uri: 'file:///note.txt', mimeType: 'text/plain', text: 'note body' } },
            { type: 'resource_link', uri: 'file:///note.txt', name: 'note.txt' },
          ],
          isError: false,
        })
      }
      if (params?.name === 'pid') {
        // Proves two calls landed on one session: the same process answers both.
        return result(id, { content: [{ type: 'text', text: String(process.pid) }], isError: false })
      }
      return failure(id, -32602, `unknown tool ${String(params?.name)}`)
    }
    default:
      return failure(id, -32601, `unknown method ${String(method)}`)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line !== '') {
      try {
        handle(JSON.parse(line))
      } catch {
        // A malformed line is not a request this fixture can answer.
      }
    }
    newline = buffer.indexOf('\n')
  }
})
