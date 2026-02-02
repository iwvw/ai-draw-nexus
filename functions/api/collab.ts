import { corsHeaders, handleCors } from './_shared/cors'

// In-memory store for connected clients (only works in single-process env like docker/wrangler dev)
// For production Cloudflare deployment, Durable Objects should be used.
const clients = new Set<WebSocket>()

export const onRequest = async (context: any) => {
  const request = context.request as Request

  // Handle CORS
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse

  // Check for WebSocket upgrade header
  const upgradeHeader = request.headers.get('Upgrade')
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', {
      status: 426,
      headers: corsHeaders
    })
  }

  // Create WebSocket pair
  const webSocketPair = new WebSocketPair()
  const [client, server] = Object.values(webSocketPair)

  // Configure server-side WebSocket
  server.accept()

  // Add to clients collection
  clients.add(server)

  // Message handler - Broadcast to all other clients
  server.addEventListener('message', (event) => {
    // Check quota or auth here if needed

    // Broadcast
    for (const otherClient of clients) {
      if (otherClient !== server && otherClient.readyState === WebSocket.OPEN) {
        try {
          otherClient.send(event.data)
        } catch (e) {
          console.error('Failed to send to client', e)
        }
      }
    }
  })

  // Close handler
  server.addEventListener('close', () => {
    clients.delete(server)
  })

  // Error handler
  server.addEventListener('error', () => {
    clients.delete(server)
  })

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: corsHeaders
  })
}
