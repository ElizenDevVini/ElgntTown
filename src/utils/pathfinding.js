/**
 * Eliza Town - Pathfinding Utility
 * 
 * Handles agent movement and navigation in the town.
 * 
 * TODO: This file needs more implementation!
 * 
 * Key responsibilities:
 * - Calculate paths between hubs
 * - Update agent positions smoothly
 * - Handle collision avoidance
 * - Support waypoints and obstacles
 */

/**
 * Calculate distance between two points
 */
export function distance(p1, p2) {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Linear interpolation between two values
 */
export function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * Linear interpolation between two points
 */
export function lerpPoint(p1, p2, t) {
  return {
    x: lerp(p1.x, p2.x, t),
    y: lerp(p1.y, p2.y, t),
    z: lerp(p1.z || 0, p2.z || 0, t)
  }
}

/**
 * Normalize a vector
 */
export function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y)
  if (len === 0) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

/**
 * Move agent toward target hub
 * Returns true if agent has arrived
 */
export async function moveAgentToHub(agent, hub, speed, deltaTime) {
  const currentPos = { x: agent.position_x, y: agent.position_y }
  const targetPos = { x: hub.position_x, y: hub.position_y }
  
  const dist = distance(currentPos, targetPos)
  const arrivalThreshold = 0.1
  
  if (dist < arrivalThreshold) {
    // Arrived
    return true
  }
  
  // Calculate movement
  const moveDistance = speed * deltaTime
  const t = Math.min(moveDistance / dist, 1)
  
  const newPos = lerpPoint(currentPos, targetPos, t)
  
  // Update agent position in memory
  agent.position_x = newPos.x
  agent.position_y = newPos.y
  
  return false
}

/**
 * Get current agent position
 */
export function getAgentPosition(agent) {
  return {
    x: agent.position_x,
    y: agent.position_y,
    z: agent.position_z || 0
  }
}

/**
 * Calculate direction from agent to target
 */
export function getDirection(agent, target) {
  const dir = {
    x: target.x - agent.position_x,
    y: target.y - agent.position_y
  }
  return normalize(dir)
}

/**
 * Check if two agents are close enough to chat
 */
export function canChat(agent1, agent2, chatDistance = 2) {
  const p1 = getAgentPosition(agent1)
  const p2 = getAgentPosition(agent2)
  return distance(p1, p2) < chatDistance
}

/**
 * Find a meeting point between two agents
 * 
 * TODO: Implement smarter meeting point calculation
 * - Consider hub locations
 * - Avoid obstacles
 * - Find neutral ground
 */
export function findMeetingPoint(agent1, agent2) {
  const p1 = getAgentPosition(agent1)
  const p2 = getAgentPosition(agent2)
  
  // Simple: meet in the middle
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
    z: 0
  }
}

/**
 * A* Pathfinding (basic implementation)
 * 
 * TODO: Implement full A* with obstacles
 * - Define walkable areas
 * - Add obstacle avoidance
 * - Cache paths for performance
 */
export function findPath(start, end, obstacles = []) {
  // For now, just return direct path
  // TODO: Implement actual A* algorithm
  
  return [start, end]
}

/**
 * Smooth a path using Catmull-Rom spline
 * 
 * TODO: Implement path smoothing
 * - Makes movement look more natural
 * - Avoid sharp corners
 */
export function smoothPath(path, resolution = 10) {
  // TODO: Implement Catmull-Rom interpolation
  return path
}

/**
 * Check if path is blocked by an obstacle
 * 
 * TODO: Implement collision detection
 */
export function isPathBlocked(start, end, obstacles) {
  // TODO: Implement line-obstacle intersection
  return false
}

/**
 * Get all agents within a radius of a point
 * 
 * TODO: Implement spatial queries
 * - Could use quadtree for performance
 */
export function getAgentsNearPoint(point, agents, radius) {
  return agents.filter(agent => {
    const pos = getAgentPosition(agent)
    return distance(pos, point) < radius
  })
}

/**
 * Calculate avoidance vector to prevent agent collisions
 * 
 * TODO: Implement collision avoidance
 * - Steer away from nearby agents
 * - Maintain personal space
 */
export function calculateAvoidance(agent, nearbyAgents, personalSpace = 1) {
  // TODO: Implement steering behavior
  return { x: 0, y: 0 }
}

export default {
  distance,
  lerp,
  lerpPoint,
  normalize,
  moveAgentToHub,
  getAgentPosition,
  getDirection,
  canChat,
  findMeetingPoint,
  findPath,
  smoothPath,
  isPathBlocked,
  getAgentsNearPoint,
  calculateAvoidance
}
