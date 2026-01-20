/**
 * Eliza Town - Database Client
 * 
 * PostgreSQL connection pool and query helper.
 */

import pg from 'pg'

const { Pool } = pg

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})

// Log connection events
pool.on('connect', () => {
  console.log('[DB] Client connected')
})

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err)
})

/**
 * Execute a query
 */
export async function query(text, params) {
  const start = Date.now()
  const result = await pool.query(text, params)
  const duration = Date.now() - start
  
  if (duration > 100) {
    console.log(`[DB] Slow query (${duration}ms):`, text.slice(0, 100))
  }
  
  return result
}

/**
 * Get a client for transactions
 */
export async function getClient() {
  const client = await pool.connect()
  const originalRelease = client.release.bind(client)
  
  // Override release to log
  client.release = () => {
    client.release = originalRelease
    return originalRelease()
  }
  
  return client
}

/**
 * Execute a transaction
 */
export async function transaction(callback) {
  const client = await getClient()
  
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Close all connections
 */
export async function close() {
  await pool.end()
  console.log('[DB] Pool closed')
}

// Export as db object for convenience
export const db = {
  query,
  getClient,
  transaction,
  close,
  pool
}

export default db
