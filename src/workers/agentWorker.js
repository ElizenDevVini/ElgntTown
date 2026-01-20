/**
 * Eliza Town - Agent Worker
 * 
 * Individual agent execution runtime.
 * Each agent runs in its own worker context.
 * 
 * TODO: This file needs implementation!
 * 
 * Key responsibilities:
 * - Run agent reasoning loop
 * - Manage agent memory and context
 * - Handle tool execution
 * - Communicate with other agents
 */

import { db } from '../db/client.js'
import { callAgent, parseAgentResponse } from '../agents/claude.js'
import { agentConfigs } from '../agents/configs.js'
import { emit } from '../api/websocket.js'

class AgentWorker {
  constructor(agentId) {
    this.agentId = agentId
    this.agent = null
    this.config = null
    this.running = false
    this.currentSubtask = null
    this.memory = []
    this.conversationHistory = []
  }

  /**
   * Initialize the worker with agent data
   */
  async init() {
    const result = await db.query('SELECT * FROM agents WHERE id = $1', [this.agentId])
    this.agent = result.rows[0]
    this.config = agentConfigs[this.agent.type]
    
    // Load agent memory
    await this.loadMemory()
    
    console.log(`[AgentWorker] Initialized ${this.agent.name} (${this.agent.type})`)
  }

  /**
   * Load agent memory from database
   * 
   * TODO: Implement memory retrieval
   * - Load recent memories
   * - Score by importance and recency
   * - Compress old memories
   */
  async loadMemory() {
    // TODO: Implement this
    //
    // const result = await db.query(`
    //   SELECT * FROM agent_memory 
    //   WHERE agent_id = $1 
    //   ORDER BY importance DESC, accessed_at DESC
    //   LIMIT 50
    // `, [this.agentId])
    //
    // this.memory = result.rows
  }

  /**
   * Save a new memory
   * 
   * TODO: Implement memory persistence
   * - Extract key facts from conversations
   * - Calculate importance scores
   * - Deduplicate similar memories
   */
  async saveMemory(content, type = 'fact', importance = 0.5) {
    // TODO: Implement this
    //
    // await db.query(`
    //   INSERT INTO agent_memory (agent_id, memory_type, content, importance)
    //   VALUES ($1, $2, $3, $4)
    // `, [this.agentId, type, content, importance])
  }

  /**
   * Execute a subtask
   * 
   * TODO: Implement full execution pipeline
   * - Build context from memory and previous work
   * - Call Claude with appropriate prompt
   * - Parse and validate response
   * - Handle tool calls if needed
   * - Update state and emit events
   */
  async executeSubtask(subtask) {
    this.currentSubtask = subtask
    
    console.log(`[AgentWorker] ${this.agent.name} executing: ${subtask.description}`)
    
    // Update status
    await this.updateStatus('working', subtask.description.slice(0, 50))

    try {
      // Build prompt with context
      const prompt = await this.buildPrompt(subtask)
      
      // Emit starting message
      emit('agent_speak', {
        agent: this.agent.type,
        text: this.getStartingPhrase(),
        type: 'saying'
      })

      // Call Claude
      const response = await callAgent(this.agent.type, prompt)
      const parsed = parseAgentResponse(response)

      // Emit bubbles
      if (parsed.thinking) {
        emit('agent_think', { agent: this.agent.type, text: parsed.thinking })
      }
      if (parsed.saying) {
        emit('agent_speak', {
          agent: this.agent.type,
          text: parsed.saying,
          toAgent: parsed.toAgent,
          type: 'saying'
        })
      }

      // Process output
      await this.processOutput(parsed, subtask)

      // Update subtask
      await db.query(
        `UPDATE subtasks SET status = 'completed', output = $2, completed_at = NOW() WHERE id = $1`,
        [subtask.id, parsed.output || response]
      )

      return parsed

    } catch (error) {
      console.error(`[AgentWorker] Execution error:`, error)
      await this.updateStatus('idle')
      throw error
    }

    this.currentSubtask = null
  }

  /**
   * Build prompt with context
   * 
   * TODO: Implement smart context building
   * - Include relevant memories
   * - Include previous agent outputs
   * - Include conversation history
   * - Stay within token limits
   */
  async buildPrompt(subtask) {
    let prompt = `Task: ${subtask.description}\n\n`

    // Add previous outputs
    const prevOutputs = await this.getPreviousOutputs(subtask.task_id, subtask.sequence)
    if (Object.keys(prevOutputs).length > 0) {
      prompt += `Previous work:\n`
      for (const [agent, output] of Object.entries(prevOutputs)) {
        prompt += `- ${agent}: ${output.slice(0, 500)}\n`
      }
      prompt += '\n'
    }

    // TODO: Add relevant memories
    // const relevantMemories = this.getRelevantMemories(subtask.description)
    // if (relevantMemories.length > 0) {
    //   prompt += `Your memories:\n`
    //   for (const mem of relevantMemories) {
    //     prompt += `- ${mem.content}\n`
    //   }
    //   prompt += '\n'
    // }

    prompt += 'Complete your part of this task.'

    return prompt
  }

  /**
   * Get outputs from previous agents in the task
   */
  async getPreviousOutputs(taskId, beforeSequence) {
    const result = await db.query(`
      SELECT agent_type, output FROM subtasks
      WHERE task_id = $1 AND sequence < $2 AND status = 'completed'
      ORDER BY sequence
    `, [taskId, beforeSequence])

    const outputs = {}
    for (const row of result.rows) {
      outputs[row.agent_type] = row.output
    }
    return outputs
  }

  /**
   * Process agent output
   * 
   * TODO: Implement output processing
   * - Handle file creation
   * - Handle tool calls
   * - Handle agent chat requests
   * - Extract and save memories
   */
  async processOutput(parsed, subtask) {
    // Handle files
    if (parsed.files && parsed.files.length > 0) {
      for (const file of parsed.files) {
        await this.saveFile(subtask.task_id, file)
      }
    }

    // Handle chat requests
    if (parsed.needsHelp && parsed.helpTopic) {
      await this.requestHelp(parsed.needsHelp, parsed.helpTopic, subtask.task_id)
    }

    // TODO: Extract memories from output
    // await this.extractMemories(parsed)
  }

  /**
   * Save a file output
   * 
   * TODO: Implement file saving
   * - Save to filesystem or S3
   * - Record in database
   * - Emit file created event
   */
  async saveFile(taskId, file) {
    // TODO: Implement this
    console.log(`[AgentWorker] Would save file: ${file.name}`)
    
    // const filepath = `tasks/${taskId}/${file.name}`
    // await writeFile(filepath, file.content)
    //
    // await db.query(`
    //   INSERT INTO task_files (task_id, filename, filepath, created_by)
    //   VALUES ($1, $2, $3, $4)
    // `, [taskId, file.name, filepath, this.agentId])
    //
    // emit('file_created', { taskId, filename: file.name })
  }

  /**
   * Request help from another agent
   * 
   * TODO: Implement agent-to-agent communication
   * - Create message in database
   * - Move both agents to meeting point
   * - Emit chat request event
   */
  async requestHelp(toAgentType, topic, taskId) {
    console.log(`[AgentWorker] ${this.agent.name} requesting help from ${toAgentType}: ${topic}`)

    // TODO: Implement this
    //
    // const toAgent = await getAgentByType(toAgentType)
    //
    // await db.query(`
    //   INSERT INTO messages (task_id, from_agent_id, to_agent_id, from_agent_type, to_agent_type, content)
    //   VALUES ($1, $2, $3, $4, $5, $6)
    // `, [taskId, this.agentId, toAgent.id, this.agent.type, toAgentType, topic])
    //
    // emit('agent_chat_request', { from: this.agent.type, to: toAgentType, topic })
  }

  /**
   * Handle incoming message from another agent
   * 
   * TODO: Implement message handling
   * - Read message content
   * - Generate response
   * - Send response back
   */
  async handleMessage(message) {
    console.log(`[AgentWorker] ${this.agent.name} received message from ${message.from_agent_type}`)

    // TODO: Implement this
  }

  /**
   * Update agent status in database
   */
  async updateStatus(status, doing = null) {
    await db.query(
      `UPDATE agents SET status = $2, doing = $3 WHERE id = $1`,
      [this.agentId, status, doing]
    )
    emit('agent_status', { agent: this.agent.type, status, doing })
  }

  /**
   * Get a random starting phrase
   */
  getStartingPhrase() {
    const phrases = {
      planner: ['Let me think about this...', 'Breaking this down...', 'Alright, here\'s the plan...'],
      designer: ['Let me visualize this...', 'Thinking about the look...', 'I see it now...'],
      coder: ['Time to code...', 'Let me build this...', 'Writing some code...'],
      reviewer: ['Let me check this...', 'Reviewing now...', 'Looking it over...']
    }
    const options = phrases[this.agent.type] || ['On it...']
    return options[Math.floor(Math.random() * options.length)]
  }

  /**
   * Get relevant memories for a topic
   * 
   * TODO: Implement memory retrieval with relevance scoring
   */
  getRelevantMemories(topic) {
    // TODO: Implement semantic search or keyword matching
    return []
  }
}

/**
 * Create and initialize an agent worker
 */
export async function createAgentWorker(agentId) {
  const worker = new AgentWorker(agentId)
  await worker.init()
  return worker
}

export default AgentWorker
