/**
 * Eliza Town - Agent State Machine
 * 
 * Manages the lifecycle states of each agent.
 */

export const AgentStatus = {
  IDLE: 'idle',
  TRAVELING: 'traveling',
  WORKING: 'working',
  CHATTING: 'chatting',
  WAITING: 'waiting',
  BLOCKED: 'blocked'
}

export const AgentEvents = {
  ASSIGN_TASK: 'assign_task',
  START_TRAVEL: 'start_travel',
  ARRIVE: 'arrive',
  START_WORK: 'start_work',
  COMPLETE_WORK: 'complete_work',
  REQUEST_CHAT: 'request_chat',
  END_CHAT: 'end_chat',
  BLOCK: 'block',
  UNBLOCK: 'unblock'
}

/**
 * Valid state transitions
 */
const transitions = {
  [AgentStatus.IDLE]: {
    [AgentEvents.ASSIGN_TASK]: AgentStatus.TRAVELING,
    [AgentEvents.START_TRAVEL]: AgentStatus.TRAVELING,
    [AgentEvents.REQUEST_CHAT]: AgentStatus.CHATTING
  },
  [AgentStatus.TRAVELING]: {
    [AgentEvents.ARRIVE]: AgentStatus.IDLE
  },
  [AgentStatus.WORKING]: {
    [AgentEvents.COMPLETE_WORK]: AgentStatus.IDLE,
    [AgentEvents.REQUEST_CHAT]: AgentStatus.CHATTING,
    [AgentEvents.BLOCK]: AgentStatus.BLOCKED
  },
  [AgentStatus.CHATTING]: {
    [AgentEvents.END_CHAT]: AgentStatus.IDLE
  },
  [AgentStatus.WAITING]: {
    [AgentEvents.UNBLOCK]: AgentStatus.WORKING
  },
  [AgentStatus.BLOCKED]: {
    [AgentEvents.UNBLOCK]: AgentStatus.WORKING
  }
}

export class AgentState {
  constructor(agent) {
    this.agentId = agent.id
    this.agentType = agent.type
    this.status = agent.status || AgentStatus.IDLE
    this.currentHub = agent.current_hub
    this.targetHub = agent.target_hub
    this.currentTask = null
    this.currentSubtask = null
    this.position = { x: agent.position_x, y: agent.position_y, z: agent.position_z || 0 }
    this.doing = agent.doing
    this.listeners = []
  }

  /**
   * Get current status
   */
  getStatus() {
    return this.status
  }

  /**
   * Check if a transition is valid
   */
  canTransition(event) {
    const possibleTransitions = transitions[this.status]
    return possibleTransitions && possibleTransitions[event]
  }

  /**
   * Attempt a state transition
   */
  transition(event, payload = {}) {
    const newStatus = this.canTransition(event)
    
    if (!newStatus) {
      console.warn(`[AgentState] Invalid transition: ${this.status} + ${event}`)
      return false
    }

    const oldStatus = this.status
    this.status = newStatus

    // Update relevant properties based on event
    switch (event) {
      case AgentEvents.ASSIGN_TASK:
        this.currentTask = payload.taskId
        this.currentSubtask = payload.subtaskId
        this.targetHub = payload.hub
        break
      
      case AgentEvents.START_TRAVEL:
        this.targetHub = payload.hub
        break
      
      case AgentEvents.ARRIVE:
        this.currentHub = this.targetHub
        this.targetHub = null
        this.position = payload.position || this.position
        break
      
      case AgentEvents.START_WORK:
        this.doing = payload.doing
        break
      
      case AgentEvents.COMPLETE_WORK:
        this.currentSubtask = null
        this.doing = null
        break
      
      case AgentEvents.REQUEST_CHAT:
        this.chattingWith = payload.withAgent
        break
      
      case AgentEvents.END_CHAT:
        this.chattingWith = null
        break
    }

    // Notify listeners
    this.emit('transition', { oldStatus, newStatus, event, payload })

    return true
  }

  // Convenience methods for common transitions

  assignTask(taskId, subtaskId, hub) {
    return this.transition(AgentEvents.ASSIGN_TASK, { taskId, subtaskId, hub })
  }

  startTravel(hub) {
    return this.transition(AgentEvents.START_TRAVEL, { hub })
  }

  arrived(position) {
    return this.transition(AgentEvents.ARRIVE, { position })
  }

  startWork(doing) {
    return this.transition(AgentEvents.START_WORK, { doing })
  }

  completeWork() {
    return this.transition(AgentEvents.COMPLETE_WORK)
  }

  startChat(withAgent) {
    return this.transition(AgentEvents.REQUEST_CHAT, { withAgent })
  }

  endChat() {
    return this.transition(AgentEvents.END_CHAT)
  }

  block() {
    return this.transition(AgentEvents.BLOCK)
  }

  unblock() {
    return this.transition(AgentEvents.UNBLOCK)
  }

  /**
   * Update position during travel
   */
  updatePosition(x, y, z = 0) {
    this.position = { x, y, z }
    this.emit('position', this.position)
  }

  /**
   * Calculate distance to target hub
   */
  distanceToTarget(targetPosition) {
    const dx = targetPosition.x - this.position.x
    const dy = targetPosition.y - this.position.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  /**
   * Check if agent has arrived at target
   */
  hasArrived(targetPosition, threshold = 0.1) {
    return this.distanceToTarget(targetPosition) < threshold
  }

  /**
   * Subscribe to state changes
   */
  on(event, callback) {
    this.listeners.push({ event, callback })
  }

  /**
   * Emit event to listeners
   */
  emit(event, data) {
    for (const listener of this.listeners) {
      if (listener.event === event) {
        listener.callback(data)
      }
    }
  }

  /**
   * Serialize state for database storage
   */
  toJSON() {
    return {
      agentId: this.agentId,
      agentType: this.agentType,
      status: this.status,
      currentHub: this.currentHub,
      targetHub: this.targetHub,
      currentTask: this.currentTask,
      currentSubtask: this.currentSubtask,
      position: this.position,
      doing: this.doing,
      chattingWith: this.chattingWith
    }
  }

  /**
   * Restore state from database
   */
  static fromJSON(data) {
    const state = new AgentState({
      id: data.agentId,
      type: data.agentType,
      status: data.status,
      current_hub: data.currentHub,
      target_hub: data.targetHub,
      position_x: data.position?.x,
      position_y: data.position?.y,
      position_z: data.position?.z,
      doing: data.doing
    })
    state.currentTask = data.currentTask
    state.currentSubtask = data.currentSubtask
    state.chattingWith = data.chattingWith
    return state
  }
}

/**
 * Manager for all agent states
 */
export class AgentStateManager {
  constructor() {
    this.agents = new Map()
  }

  /**
   * Add or update an agent
   */
  set(agentId, agent) {
    const state = new AgentState(agent)
    this.agents.set(agentId, state)
    return state
  }

  /**
   * Get agent state
   */
  get(agentId) {
    return this.agents.get(agentId)
  }

  /**
   * Get agent by type
   */
  getByType(type) {
    for (const state of this.agents.values()) {
      if (state.agentType === type) return state
    }
    return null
  }

  /**
   * Get all agents with a specific status
   */
  getByStatus(status) {
    return Array.from(this.agents.values()).filter(a => a.status === status)
  }

  /**
   * Get all idle agents
   */
  getIdleAgents() {
    return this.getByStatus(AgentStatus.IDLE)
  }

  /**
   * Get all traveling agents
   */
  getTravelingAgents() {
    return this.getByStatus(AgentStatus.TRAVELING)
  }

  /**
   * Get all working agents
   */
  getWorkingAgents() {
    return this.getByStatus(AgentStatus.WORKING)
  }

  /**
   * Serialize all states
   */
  toJSON() {
    const result = {}
    for (const [id, state] of this.agents) {
      result[id] = state.toJSON()
    }
    return result
  }

  /**
   * Broadcast state to all listeners
   */
  broadcast(event, data) {
    for (const state of this.agents.values()) {
      state.emit(event, data)
    }
  }
}

export const agentStateManager = new AgentStateManager()
