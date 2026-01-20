/**
 * Eliza Town - Main Server
 * 
 * Entry point for the Eliza Town backend.
 */

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'

import routes from './src/api/routes.js'
import { initWebSocket } from './src/api/websocket.js'
import { orchestrator } from './src/orchestration/loop.js'
import { db } from './src/db/client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const server = createServer(app)

const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// API routes
app.use('/api', routes)

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// Initialize WebSocket
initWebSocket(server)

// Start server
server.listen(PORT, async () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║         🏘️  ELIZA TOWN  🏘️            ║
  ║                                       ║
  ║   Server running on port ${PORT}        ║
  ║   http://localhost:${PORT}              ║
  ╚═══════════════════════════════════════╝
  `)

  // Test database connection
  try {
    await db.query('SELECT NOW()')
    console.log('[Server] Database connected')
  } catch (error) {
    console.error('[Server] Database connection failed:', error.message)
    console.log('[Server] Make sure PostgreSQL is running and DATABASE_URL is set')
  }

  // Start orchestrator
  if (process.env.AUTO_START_ORCHESTRATOR === 'true') {
    await orchestrator.start()
    console.log('[Server] Orchestrator started')
  } else {
    console.log('[Server] Orchestrator not auto-started. POST /api/orchestrator/start to begin')
  }
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...')
  orchestrator.stop()
  await db.close()
  server.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('[Server] Interrupted, shutting down...')
  orchestrator.stop()
  await db.close()
  server.close()
  process.exit(0)
})
