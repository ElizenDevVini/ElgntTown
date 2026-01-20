/**
 * Eliza Town - API Routes
 * 
 * REST endpoints for task management, agent control, and data retrieval.
 */

import express from 'express'
import { db } from '../db/client.js'
import { orchestrator } from '../orchestration/loop.js'
import { emit } from './websocket.js'

const router = express.Router()

// ============================================
// TASKS
// ============================================

/**
 * Create a new task
 * POST /api/tasks
 * Body: { prompt: string, userId?: string }
 */
router.post('/tasks', async (req, res) => {
  try {
    const { prompt, userId } = req.body

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    const result = await db.query(
      `INSERT INTO tasks (prompt, user_id) VALUES ($1, $2) RETURNING *`,
      [prompt, userId || 'anonymous']
    )

    const task = result.rows[0]

    // Notify frontend
    emit('task_created', { taskId: task.id, prompt: task.prompt })

    res.status(201).json(task)
  } catch (error) {
    console.error('[API] Create task error:', error)
    res.status(500).json({ error: 'Failed to create task' })
  }
})

/**
 * Get task by ID
 * GET /api/tasks/:id
 */
router.get('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params

    const taskResult = await db.query('SELECT * FROM tasks WHERE id = $1', [id])
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' })
    }

    const task = taskResult.rows[0]

    // Get subtasks
    const subtasksResult = await db.query(
      'SELECT * FROM subtasks WHERE task_id = $1 ORDER BY sequence',
      [id]
    )

    // Get messages
    const messagesResult = await db.query(
      'SELECT * FROM messages WHERE task_id = $1 ORDER BY created_at',
      [id]
    )

    // Get files
    const filesResult = await db.query(
      'SELECT * FROM task_files WHERE task_id = $1',
      [id]
    )

    res.json({
      ...task,
      subtasks: subtasksResult.rows,
      messages: messagesResult.rows,
      files: filesResult.rows
    })
  } catch (error) {
    console.error('[API] Get task error:', error)
    res.status(500).json({ error: 'Failed to get task' })
  }
})

/**
 * List all tasks
 * GET /api/tasks
 * Query: status, userId, limit, offset
 */
router.get('/tasks', async (req, res) => {
  try {
    const { status, userId, limit = 20, offset = 0 } = req.query

    let query = 'SELECT * FROM tasks WHERE 1=1'
    const params = []

    if (status) {
      params.push(status)
      query += ` AND status = $${params.length}`
    }

    if (userId) {
      params.push(userId)
      query += ` AND user_id = $${params.length}`
    }

    query += ' ORDER BY created_at DESC'
    
    params.push(limit)
    query += ` LIMIT $${params.length}`
    
    params.push(offset)
    query += ` OFFSET $${params.length}`

    const result = await db.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('[API] List tasks error:', error)
    res.status(500).json({ error: 'Failed to list tasks' })
  }
})

/**
 * Cancel a task
 * POST /api/tasks/:id/cancel
 */
router.post('/tasks/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params

    await db.query(
      `UPDATE tasks SET status = 'cancelled' WHERE id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [id]
    )

    emit('task_cancelled', { taskId: id })

    res.json({ success: true })
  } catch (error) {
    console.error('[API] Cancel task error:', error)
    res.status(500).json({ error: 'Failed to cancel task' })
  }
})

// ============================================
// AGENTS
// ============================================

/**
 * Get all agents
 * GET /api/agents
 */
router.get('/agents', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM agents ORDER BY type')
    res.json(result.rows)
  } catch (error) {
    console.error('[API] Get agents error:', error)
    res.status(500).json({ error: 'Failed to get agents' })
  }
})

/**
 * Get agent by ID
 * GET /api/agents/:id
 */
router.get('/agents/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await db.query('SELECT * FROM agents WHERE id = $1', [id])
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('[API] Get agent error:', error)
    res.status(500).json({ error: 'Failed to get agent' })
  }
})

/**
 * Update agent configuration
 * PATCH /api/agents/:id
 * Body: { model?, systemPrompt?, personality?, color? }
 */
router.patch('/agents/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { model, systemPrompt, personality, color, name } = req.body

    const updates = []
    const params = [id]
    let paramIndex = 2

    if (model) {
      updates.push(`model = $${paramIndex++}`)
      params.push(model)
    }
    if (systemPrompt) {
      updates.push(`system_prompt = $${paramIndex++}`)
      params.push(systemPrompt)
    }
    if (personality) {
      updates.push(`personality = $${paramIndex++}`)
      params.push(JSON.stringify(personality))
    }
    if (color) {
      updates.push(`color = $${paramIndex++}`)
      params.push(color)
    }
    if (name) {
      updates.push(`name = $${paramIndex++}`)
      params.push(name)
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' })
    }

    const query = `UPDATE agents SET ${updates.join(', ')} WHERE id = $1 RETURNING *`
    const result = await db.query(query, params)

    emit('agent_updated', { agent: result.rows[0] })

    res.json(result.rows[0])
  } catch (error) {
    console.error('[API] Update agent error:', error)
    res.status(500).json({ error: 'Failed to update agent' })
  }
})

/**
 * Move agent to hub (manual override)
 * POST /api/agents/:id/move
 * Body: { hub: string }
 */
router.post('/agents/:id/move', async (req, res) => {
  try {
    const { id } = req.params
    const { hub } = req.body

    // Verify hub exists
    const hubResult = await db.query('SELECT * FROM hubs WHERE id = $1', [hub])
    if (hubResult.rows.length === 0) {
      return res.status(404).json({ error: 'Hub not found' })
    }

    await db.query(
      `UPDATE agents SET target_hub = $2, status = 'traveling' WHERE id = $1`,
      [id, hub]
    )

    const agentResult = await db.query('SELECT * FROM agents WHERE id = $1', [id])
    const agent = agentResult.rows[0]
    const targetHub = hubResult.rows[0]

    emit('agent_move', {
      agent: agent.type,
      from: { x: agent.position_x, y: agent.position_y },
      to: { x: targetHub.position_x, y: targetHub.position_y },
      hub
    })

    res.json({ success: true })
  } catch (error) {
    console.error('[API] Move agent error:', error)
    res.status(500).json({ error: 'Failed to move agent' })
  }
})

// ============================================
// HUBS
// ============================================

/**
 * Get all hubs
 * GET /api/hubs
 */
router.get('/hubs', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM hubs ORDER BY type, name')
    res.json(result.rows)
  } catch (error) {
    console.error('[API] Get hubs error:', error)
    res.status(500).json({ error: 'Failed to get hubs' })
  }
})

/**
 * Create a new hub
 * POST /api/hubs
 */
router.post('/hubs', async (req, res) => {
  try {
    const { id, name, description, type, positionX, positionY } = req.body

    const result = await db.query(
      `INSERT INTO hubs (id, name, description, type, position_x, position_y) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, name, description, type, positionX, positionY]
    )

    emit('hub_created', { hub: result.rows[0] })

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('[API] Create hub error:', error)
    res.status(500).json({ error: 'Failed to create hub' })
  }
})

// ============================================
// MESSAGES
// ============================================

/**
 * Get recent messages
 * GET /api/messages
 * Query: taskId, limit
 */
router.get('/messages', async (req, res) => {
  try {
    const { taskId, limit = 50 } = req.query

    let query = 'SELECT m.*, fa.name as from_name, ta.name as to_name FROM messages m '
    query += 'LEFT JOIN agents fa ON m.from_agent_id = fa.id '
    query += 'LEFT JOIN agents ta ON m.to_agent_id = ta.id '
    
    const params = []
    
    if (taskId) {
      params.push(taskId)
      query += `WHERE m.task_id = $${params.length} `
    }
    
    query += 'ORDER BY m.created_at DESC '
    params.push(limit)
    query += `LIMIT $${params.length}`

    const result = await db.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('[API] Get messages error:', error)
    res.status(500).json({ error: 'Failed to get messages' })
  }
})

// ============================================
// EVENTS
// ============================================

/**
 * Get event log
 * GET /api/events
 * Query: type, agentId, limit
 */
router.get('/events', async (req, res) => {
  try {
    const { type, agentId, limit = 100 } = req.query

    let query = 'SELECT * FROM event_log WHERE 1=1'
    const params = []

    if (type) {
      params.push(type)
      query += ` AND event_type = $${params.length}`
    }

    if (agentId) {
      params.push(agentId)
      query += ` AND agent_id = $${params.length}`
    }

    query += ' ORDER BY created_at DESC'
    params.push(limit)
    query += ` LIMIT $${params.length}`

    const result = await db.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('[API] Get events error:', error)
    res.status(500).json({ error: 'Failed to get events' })
  }
})

// ============================================
// SYSTEM
// ============================================

/**
 * Get system status
 * GET /api/status
 */
router.get('/status', async (req, res) => {
  try {
    const tasksResult = await db.query(
      `SELECT status, COUNT(*) as count FROM tasks GROUP BY status`
    )
    
    const agentsResult = await db.query(
      `SELECT status, COUNT(*) as count FROM agents GROUP BY status`
    )

    res.json({
      orchestrator: orchestrator.running ? 'running' : 'stopped',
      tasks: tasksResult.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count)
        return acc
      }, {}),
      agents: agentsResult.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count)
        return acc
      }, {})
    })
  } catch (error) {
    console.error('[API] Get status error:', error)
    res.status(500).json({ error: 'Failed to get status' })
  }
})

/**
 * Start orchestrator
 * POST /api/orchestrator/start
 */
router.post('/orchestrator/start', async (req, res) => {
  try {
    await orchestrator.start()
    res.json({ success: true, status: 'running' })
  } catch (error) {
    console.error('[API] Start orchestrator error:', error)
    res.status(500).json({ error: 'Failed to start orchestrator' })
  }
})

/**
 * Stop orchestrator
 * POST /api/orchestrator/stop
 */
router.post('/orchestrator/stop', async (req, res) => {
  try {
    orchestrator.stop()
    res.json({ success: true, status: 'stopped' })
  } catch (error) {
    console.error('[API] Stop orchestrator error:', error)
    res.status(500).json({ error: 'Failed to stop orchestrator' })
  }
})

export default router
