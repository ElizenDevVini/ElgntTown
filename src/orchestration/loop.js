/**
 * Eliza Town - Orchestration Loop
 * 
 * The main tick loop that processes tasks and coordinates agents.
 * Runs continuously, checking for pending work and moving agents.
 */

import { db } from '../db/client.js'
import { agentConfigs } from '../agents/configs.js'
import { callAgent } from '../agents/claude.js'
import { AgentState } from './state.js'
import { emit } from '../api/websocket.js'
import { moveAgentToHub, getAgentPosition } from '../utils/pathfinding.js'
import { saveTaskFiles, packageResult } from '../utils/files.js'

const TICK_INTERVAL = 1000 // 1 second
const AGENT_SPEED = 2 // units per second

class Orchestrator {
  constructor() {
    this.running = false
    this.agentStates = new Map()
    this.activeTasks = new Map()
  }

  async start() {
    console.log('[Orchestrator] Starting...')
    this.running = true
    
    // Initialize agent states
    const agents = await db.query('SELECT * FROM agents')
    for (const agent of agents.rows) {
      this.agentStates.set(agent.id, new AgentState(agent))
    }
    
    // Start the tick loop
    this.tick()
  }

  stop() {
    console.log('[Orchestrator] Stopping...')
    this.running = false
  }

  async tick() {
    if (!this.running) return

    try {
      // 1. Check for pending tasks
      await this.processPendingTasks()
      
      // 2. Update agent positions (movement)
      await this.updateAgentPositions()
      
      // 3. Process active subtasks
      await this.processSubtasks()
      
      // 4. Handle agent communications
      await this.processMessages()
      
    } catch (error) {
      console.error('[Orchestrator] Tick error:', error)
    }

    // Schedule next tick
    setTimeout(() => this.tick(), TICK_INTERVAL)
  }

  /**
   * Find pending tasks and assign to planner
   */
  async processPendingTasks() {
    const result = await db.query(
      `SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at LIMIT 5`
    )

    for (const task of result.rows) {
      console.log(`[Orchestrator] Processing task: ${task.id}`)
      
      // Update task status
      await db.query(
        `UPDATE tasks SET status = 'planning', started_at = NOW() WHERE id = $1`,
        [task.id]
      )
      
      // Get planner agent
      const planner = await this.getAgentByType('planner')
      
      // Move planner to planning room
      await this.assignAgentToHub(planner.id, 'planning_room')
      
      // Emit event
      emit('task_started', { taskId: task.id, agent: 'planner' })
      
      // Add to active tasks
      this.activeTasks.set(task.id, {
        task,
        phase: 'planning',
        waitingFor: planner.id
      })
    }
  }

  /**
   * Move agents toward their target hubs
   */
  async updateAgentPositions() {
    const agents = await db.query(
      `SELECT * FROM agents WHERE target_hub IS NOT NULL AND status = 'traveling'`
    )

    for (const agent of agents.rows) {
      const hub = await this.getHub(agent.target_hub)
      const arrived = await moveAgentToHub(agent, hub, AGENT_SPEED, TICK_INTERVAL / 1000)
      
      if (arrived) {
        // Agent has arrived
        await db.query(
          `UPDATE agents 
           SET current_hub = target_hub, 
               target_hub = NULL, 
               status = 'idle',
               position_x = $2,
               position_y = $3
           WHERE id = $1`,
          [agent.id, hub.position_x, hub.position_y]
        )
        
        emit('agent_arrived', { 
          agent: agent.type, 
          hub: hub.id,
          position: { x: hub.position_x, y: hub.position_y }
        })
        
        // Update local state
        const state = this.agentStates.get(agent.id)
        if (state) state.arrived()
      } else {
        // Still moving
        const pos = getAgentPosition(agent)
        await db.query(
          `UPDATE agents SET position_x = $2, position_y = $3 WHERE id = $1`,
          [agent.id, pos.x, pos.y]
        )
        
        emit('agent_position', {
          agent: agent.type,
          position: pos
        })
      }
    }
  }

  /**
   * Process subtasks that are ready for work
   */
  async processSubtasks() {
    // Get subtasks where agent has arrived at hub
    const result = await db.query(`
      SELECT s.*, a.status as agent_status, a.current_hub
      FROM subtasks s
      JOIN agents a ON s.agent_id = a.id
      WHERE s.status = 'assigned' 
        AND a.status = 'idle'
        AND a.current_hub = s.hub_id
      ORDER BY s.sequence
    `)

    for (const subtask of result.rows) {
      await this.executeSubtask(subtask)
    }
  }

  /**
   * Execute a single subtask with an agent
   */
  async executeSubtask(subtask) {
    const agent = await this.getAgent(subtask.agent_id)
    const config = agentConfigs[agent.type]
    
    console.log(`[Orchestrator] Agent ${agent.type} starting subtask: ${subtask.description}`)
    
    // Update status
    await db.query(
      `UPDATE subtasks SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
      [subtask.id]
    )
    await db.query(
      `UPDATE agents SET status = 'working', doing = $2 WHERE id = $1`,
      [agent.id, subtask.description.slice(0, 50)]
    )
    
    emit('agent_status', { 
      agent: agent.type, 
      status: 'working', 
      doing: subtask.description.slice(0, 50) 
    })

    // Build context from previous subtasks
    const context = await this.buildContext(subtask.task_id, subtask.sequence)
    
    // Call Claude
    const prompt = this.buildPrompt(subtask, context)
    
    emit('agent_speak', { 
      agent: agent.type, 
      text: this.getStartingMessage(agent.type),
      type: 'saying'
    })

    try {
      const response = await callAgent(agent.type, prompt)
      const parsed = this.parseAgentResponse(response)
      
      // Emit speech/thought bubbles
      if (parsed.thinking) {
        emit('agent_think', { agent: agent.type, text: parsed.thinking })
      }
      if (parsed.saying) {
        emit('agent_speak', { 
          agent: agent.type, 
          text: parsed.saying, 
          toAgent: parsed.toAgent,
          type: 'saying'
        })
      }
      
      // Save output
      await db.query(
        `UPDATE subtasks SET status = 'completed', output = $2, completed_at = NOW() WHERE id = $1`,
        [subtask.id, parsed.output || response]
      )
      
      // Handle file outputs
      if (parsed.files && parsed.files.length > 0) {
        await saveTaskFiles(subtask.task_id, parsed.files, agent.id)
      }
      
      // Check if agent needs help from another
      if (parsed.needsHelp) {
        await this.requestAgentHelp(agent, parsed.needsHelp, parsed.helpTopic, subtask.task_id)
      }
      
      // Check if all subtasks complete
      await this.checkTaskCompletion(subtask.task_id)
      
    } catch (error) {
      console.error(`[Orchestrator] Subtask error:`, error)
      await db.query(
        `UPDATE subtasks SET status = 'failed' WHERE id = $1`,
        [subtask.id]
      )
      emit('agent_speak', { 
        agent: agent.type, 
        text: 'Something went wrong...',
        type: 'saying'
      })
    }

    // Reset agent status
    await db.query(
      `UPDATE agents SET status = 'idle', doing = NULL WHERE id = $1`,
      [agent.id]
    )
    emit('agent_status', { agent: agent.type, status: 'idle' })
  }

  /**
   * Plan a task by breaking it into subtasks
   */
  async planTask(taskId, plannerResponse) {
    const subtasks = JSON.parse(plannerResponse)
    
    for (let i = 0; i < subtasks.length; i++) {
      const st = subtasks[i]
      const agent = await this.getAgentByType(st.agent)
      const hub = agentConfigs[st.agent]?.hub || 'town_square'
      
      await db.query(`
        INSERT INTO subtasks (task_id, agent_id, agent_type, description, hub_id, sequence)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [taskId, agent.id, st.agent, st.description, hub, i])
      
      // Assign agent to hub
      await this.assignAgentToHub(agent.id, hub)
    }
    
    // Update task status
    await db.query(
      `UPDATE tasks SET status = 'in_progress' WHERE id = $1`,
      [taskId]
    )
    
    emit('task_planned', { taskId, subtaskCount: subtasks.length })
  }

  /**
   * Check if all subtasks are done and finalize task
   */
  async checkTaskCompletion(taskId) {
    const result = await db.query(
      `SELECT COUNT(*) as pending FROM subtasks WHERE task_id = $1 AND status != 'completed'`,
      [taskId]
    )
    
    if (parseInt(result.rows[0].pending) === 0) {
      // All done! Package result
      const { downloadUrl, previewUrl } = await packageResult(taskId)
      
      await db.query(`
        UPDATE tasks 
        SET status = 'completed', 
            download_url = $2, 
            preview_url = $3,
            completed_at = NOW() 
        WHERE id = $1
      `, [taskId, downloadUrl, previewUrl])
      
      emit('task_complete', { taskId, downloadUrl, previewUrl })
      
      // Celebrate! Move all agents to town square
      await this.celebrateCompletion()
    }
  }

  /**
   * Move all agents to town square for celebration
   */
  async celebrateCompletion() {
    const agents = await db.query('SELECT * FROM agents')
    
    for (const agent of agents.rows) {
      await this.assignAgentToHub(agent.id, 'town_square')
    }
    
    // Stagger celebration messages
    setTimeout(() => emit('agent_speak', { agent: 'coder', text: 'Shipped!', type: 'saying' }), 1000)
    setTimeout(() => emit('agent_speak', { agent: 'designer', text: 'Looks great!', type: 'saying' }), 1500)
    setTimeout(() => emit('agent_speak', { agent: 'reviewer', text: 'Clean code!', type: 'saying' }), 2000)
    setTimeout(() => emit('agent_speak', { agent: 'planner', text: 'Good work team!', type: 'saying' }), 2500)
  }

  /**
   * Handle agent requesting help from another
   */
  async requestAgentHelp(fromAgent, toAgentType, topic, taskId) {
    const toAgent = await this.getAgentByType(toAgentType)
    
    // Create message
    await db.query(`
      INSERT INTO messages (task_id, from_agent_id, to_agent_id, from_agent_type, to_agent_type, content, hub_id)
      VALUES ($1, $2, $3, $4, $5, $6, 'town_square')
    `, [taskId, fromAgent.id, toAgent.id, fromAgent.type, toAgentType, topic])
    
    // Move both to town square for chat
    await this.assignAgentToHub(fromAgent.id, 'town_square')
    await this.assignAgentToHub(toAgent.id, 'town_square')
    
    emit('agent_chat_request', { 
      from: fromAgent.type, 
      to: toAgentType, 
      topic 
    })
  }

  /**
   * Process pending messages between agents
   */
  async processMessages() {
    const result = await db.query(`
      SELECT m.*, 
             fa.type as from_type, fa.current_hub as from_hub,
             ta.type as to_type, ta.current_hub as to_hub
      FROM messages m
      JOIN agents fa ON m.from_agent_id = fa.id
      JOIN agents ta ON m.to_agent_id = ta.id
      WHERE m.read_at IS NULL
        AND fa.current_hub = 'town_square'
        AND ta.current_hub = 'town_square'
      ORDER BY m.created_at
    `)

    for (const msg of result.rows) {
      // Mark as read
      await db.query('UPDATE messages SET read_at = NOW() WHERE id = $1', [msg.id])
      
      // Generate response from receiving agent
      const response = await callAgent(msg.to_type, `
        ${msg.from_type} said: "${msg.content}"
        Respond briefly and helpfully.
      `)
      
      const parsed = this.parseAgentResponse(response)
      
      emit('agent_speak', { 
        agent: msg.to_type, 
        text: parsed.saying || response.slice(0, 100),
        toAgent: msg.from_type,
        type: 'saying'
      })
    }
  }

  // Helper methods

  async assignAgentToHub(agentId, hubId) {
    const agent = await this.getAgent(agentId)
    if (agent.current_hub === hubId) return
    
    await db.query(
      `UPDATE agents SET target_hub = $2, status = 'traveling' WHERE id = $1`,
      [agentId, hubId]
    )
    
    const hub = await this.getHub(hubId)
    emit('agent_move', { 
      agent: agent.type, 
      from: { x: agent.position_x, y: agent.position_y },
      to: { x: hub.position_x, y: hub.position_y },
      hub: hubId
    })
  }

  async getAgent(agentId) {
    const result = await db.query('SELECT * FROM agents WHERE id = $1', [agentId])
    return result.rows[0]
  }

  async getAgentByType(type) {
    const result = await db.query('SELECT * FROM agents WHERE type = $1', [type])
    return result.rows[0]
  }

  async getHub(hubId) {
    const result = await db.query('SELECT * FROM hubs WHERE id = $1', [hubId])
    return result.rows[0]
  }

  async buildContext(taskId, beforeSequence) {
    const result = await db.query(`
      SELECT agent_type, output 
      FROM subtasks 
      WHERE task_id = $1 AND sequence < $2 AND status = 'completed'
      ORDER BY sequence
    `, [taskId, beforeSequence])
    
    const context = {}
    for (const row of result.rows) {
      context[row.agent_type] = row.output
    }
    return context
  }

  buildPrompt(subtask, context) {
    let prompt = `Task: ${subtask.description}\n\n`
    
    if (Object.keys(context).length > 0) {
      prompt += `Previous work:\n`
      for (const [agent, output] of Object.entries(context)) {
        prompt += `- ${agent}: ${output.slice(0, 500)}\n`
      }
      prompt += '\n'
    }
    
    prompt += 'Complete your part of this task.'
    return prompt
  }

  parseAgentResponse(response) {
    try {
      return JSON.parse(response)
    } catch {
      return { output: response }
    }
  }

  getStartingMessage(agentType) {
    const messages = {
      planner: 'Let me break this down...',
      designer: 'Thinking about the visuals...',
      coder: 'Time to write some code...',
      reviewer: 'Let me check this...'
    }
    return messages[agentType] || 'On it!'
  }
}

// Singleton instance
export const orchestrator = new Orchestrator()
