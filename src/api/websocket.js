/**
 * Eliza Town - WebSocket Server
 * 
 * Real-time communication between server and frontend.
 */

import { WebSocketServer } from 'ws'

let wss = null
const clients = new Set()

/**
 * Initialize WebSocket server
 */
export function initWebSocket(server) {
  wss = new WebSocketServer({ server })

  wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected')
    clients.add(ws)

    // Send initial state
    ws.send(JSON.stringify({ 
      event: 'connected', 
      message: 'Welcome to Eliza Town' 
    }))

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data)
        handleClientMessage(ws, message)
      } catch (error) {
        console.error('[WebSocket] Invalid message:', error)
      }
    })

    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected')
      clients.delete(ws)
    })

    ws.on('error', (error) => {
      console.error('[WebSocket] Error:', error)
      clients.delete(ws)
    })
  })

  console.log('[WebSocket] Server initialized')
}

/**
 * Handle incoming client messages
 */
function handleClientMessage(ws, message) {
  const { event, data } = message

  switch (event) {
    case 'ping':
      ws.send(JSON.stringify({ event: 'pong' }))
      break

    case 'subscribe':
      // Could implement channel subscriptions here
      console.log('[WebSocket] Client subscribed to:', data?.channel)
      break

    case 'submit_task':
      // Forward to API handler
      console.log('[WebSocket] Task submitted:', data?.prompt)
      break

    default:
      console.log('[WebSocket] Unknown event:', event)
  }
}

/**
 * Emit event to all connected clients
 */
export function emit(event, data) {
  const message = JSON.stringify({ event, data, timestamp: Date.now() })

  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message)
    }
  }
}

/**
 * Emit event to specific client
 */
export function emitTo(ws, event, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ event, data, timestamp: Date.now() }))
  }
}

/**
 * Get connected client count
 */
export function getClientCount() {
  return clients.size
}

/**
 * Broadcast agent movement
 */
export function emitAgentMove(agent, from, to, hub) {
  emit('agent_move', { agent, from, to, hub })
}

/**
 * Broadcast agent status change
 */
export function emitAgentStatus(agent, status, doing = null) {
  emit('agent_status', { agent, status, doing })
}

/**
 * Broadcast agent speech bubble
 */
export function emitAgentSpeak(agent, text, toAgent = null, type = 'saying') {
  emit('agent_speak', { agent, text, toAgent, type })
}

/**
 * Broadcast agent thought bubble
 */
export function emitAgentThink(agent, text) {
  emit('agent_think', { agent, text })
}

/**
 * Broadcast task update
 */
export function emitTaskUpdate(taskId, status, result = null) {
  emit('task_update', { taskId, status, result })
}

export default {
  initWebSocket,
  emit,
  emitTo,
  getClientCount,
  emitAgentMove,
  emitAgentStatus,
  emitAgentSpeak,
  emitAgentThink,
  emitTaskUpdate
}
