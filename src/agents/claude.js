/**
 * Eliza Town - Claude API Client
 * 
 * Wrapper for Anthropic Claude API calls.
 */

import Anthropic from '@anthropic-ai/sdk'
import { agentConfigs } from './configs.js'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

/**
 * Call Claude with an agent's persona
 */
export async function callAgent(agentType, prompt, options = {}) {
  const config = agentConfigs[agentType]
  
  if (!config) {
    throw new Error(`Unknown agent type: ${agentType}`)
  }

  const {
    model = config.model || 'claude-sonnet-4-20250514',
    maxTokens = 4096,
    temperature = 0.7,
    systemOverride = null
  } = options

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemOverride || config.system,
      messages: [{ role: 'user', content: prompt }]
    })

    return response.content[0].text
  } catch (error) {
    console.error(`[Claude] Error calling agent ${agentType}:`, error)
    throw error
  }
}

/**
 * Call Claude with streaming response
 */
export async function callAgentStream(agentType, prompt, onChunk, options = {}) {
  const config = agentConfigs[agentType]
  
  if (!config) {
    throw new Error(`Unknown agent type: ${agentType}`)
  }

  const {
    model = config.model || 'claude-sonnet-4-20250514',
    maxTokens = 4096,
    temperature = 0.7
  } = options

  try {
    const stream = await client.messages.stream({
      model,
      max_tokens: maxTokens,
      temperature,
      system: config.system,
      messages: [{ role: 'user', content: prompt }]
    })

    let fullResponse = ''

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.text) {
        fullResponse += event.delta.text
        if (onChunk) onChunk(event.delta.text)
      }
    }

    return fullResponse
  } catch (error) {
    console.error(`[Claude] Stream error for agent ${agentType}:`, error)
    throw error
  }
}

/**
 * Have two agents chat with each other
 */
export async function agentChat(agent1Type, agent2Type, topic, rounds = 2) {
  const conversation = []

  let context = topic

  for (let i = 0; i < rounds; i++) {
    // Agent 1 speaks
    const msg1 = await callAgent(agent1Type, 
      `You're discussing with ${agent2Type}. Topic: ${context}\n\nRespond briefly (1-2 sentences).`
    )
    conversation.push({ from: agent1Type, text: msg1 })

    // Agent 2 responds
    const msg2 = await callAgent(agent2Type,
      `${agent1Type} said: "${msg1}"\n\nRespond briefly (1-2 sentences).`
    )
    conversation.push({ from: agent2Type, text: msg2 })

    context = msg2
  }

  return conversation
}

/**
 * Parse structured JSON response from agent
 */
export function parseAgentResponse(response) {
  // Try to extract JSON from response
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      // JSON parse failed, return raw
    }
  }

  // Return as plain output
  return {
    output: response,
    saying: null,
    thinking: null,
    doing: null
  }
}

/**
 * Build a prompt with context from previous agents
 */
export function buildContextualPrompt(task, previousOutputs = {}) {
  let prompt = `Task: ${task}\n\n`

  if (Object.keys(previousOutputs).length > 0) {
    prompt += `Previous work from other agents:\n\n`
    
    for (const [agent, output] of Object.entries(previousOutputs)) {
      prompt += `--- ${agent.toUpperCase()} ---\n${output}\n\n`
    }
  }

  prompt += `Now complete your part of this task.`

  return prompt
}

export default {
  callAgent,
  callAgentStream,
  agentChat,
  parseAgentResponse,
  buildContextualPrompt
}
