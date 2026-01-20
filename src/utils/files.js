/**
 * Eliza Town - File Handling Utility
 * 
 * Manages task output files.
 * 
 * TODO: This file needs implementation!
 * 
 * Key responsibilities:
 * - Save generated files to storage
 * - Package files for download
 * - Deploy to preview environments
 * - Clean up old files
 */

import fs from 'fs/promises'
import path from 'path'
import archiver from 'archiver'
import { createWriteStream } from 'fs'
import { db } from '../db/client.js'

const OUTPUT_DIR = process.env.OUTPUT_DIR || './outputs'
const PREVIEW_URL = process.env.PREVIEW_URL || 'http://localhost:3000/preview'

/**
 * Ensure output directory exists
 */
async function ensureOutputDir(taskId) {
  const taskDir = path.join(OUTPUT_DIR, taskId)
  await fs.mkdir(taskDir, { recursive: true })
  return taskDir
}

/**
 * Save a single file
 */
export async function saveFile(taskId, filename, content) {
  const taskDir = await ensureOutputDir(taskId)
  const filepath = path.join(taskDir, filename)
  
  await fs.writeFile(filepath, content, 'utf-8')
  
  console.log(`[Files] Saved: ${filepath}`)
  
  return filepath
}

/**
 * Save multiple files from agent output
 */
export async function saveTaskFiles(taskId, files, agentId) {
  const savedFiles = []
  
  for (const file of files) {
    const filepath = await saveFile(taskId, file.name, file.content)
    
    // Record in database
    await db.query(`
      INSERT INTO task_files (task_id, filename, filepath, filetype, created_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [taskId, file.name, filepath, getFileType(file.name), agentId])
    
    savedFiles.push({ name: file.name, path: filepath })
  }
  
  return savedFiles
}

/**
 * Get file type from extension
 */
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase()
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.jsx': 'application/javascript',
    '.ts': 'application/typescript',
    '.tsx': 'application/typescript',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.txt': 'text/plain'
  }
  return types[ext] || 'application/octet-stream'
}

/**
 * Package task files into a zip
 * 
 * TODO: Implement zip creation
 * - Gather all task files
 * - Create zip archive
 * - Return download URL
 */
export async function packageResult(taskId) {
  const taskDir = path.join(OUTPUT_DIR, taskId)
  const zipPath = path.join(OUTPUT_DIR, `${taskId}.zip`)
  
  // TODO: Implement zip creation
  //
  // return new Promise((resolve, reject) => {
  //   const output = createWriteStream(zipPath)
  //   const archive = archiver('zip', { zlib: { level: 9 } })
  //
  //   output.on('close', () => {
  //     resolve({
  //       downloadUrl: `/downloads/${taskId}.zip`,
  //       previewUrl: `${PREVIEW_URL}/${taskId}`
  //     })
  //   })
  //
  //   archive.on('error', reject)
  //   archive.pipe(output)
  //   archive.directory(taskDir, false)
  //   archive.finalize()
  // })

  // Placeholder return
  return {
    downloadUrl: `/downloads/${taskId}.zip`,
    previewUrl: `${PREVIEW_URL}/${taskId}`
  }
}

/**
 * Deploy task to preview environment
 * 
 * TODO: Implement deployment
 * - Could use Vercel API
 * - Could use Netlify API
 * - Could serve from local preview server
 */
export async function deployPreview(taskId) {
  // TODO: Implement actual deployment
  //
  // Options:
  // 1. Vercel deployment
  // const result = await vercel.deploy(taskDir)
  // return result.url
  //
  // 2. Netlify deployment
  // const result = await netlify.deploy(taskDir)
  // return result.url
  //
  // 3. Local preview server
  // return `${PREVIEW_URL}/${taskId}`

  return `${PREVIEW_URL}/${taskId}`
}

/**
 * Read a task file
 */
export async function readTaskFile(taskId, filename) {
  const filepath = path.join(OUTPUT_DIR, taskId, filename)
  return await fs.readFile(filepath, 'utf-8')
}

/**
 * List all files for a task
 */
export async function listTaskFiles(taskId) {
  const taskDir = path.join(OUTPUT_DIR, taskId)
  
  try {
    const files = await fs.readdir(taskDir)
    return files.map(f => ({
      name: f,
      path: path.join(taskDir, f)
    }))
  } catch {
    return []
  }
}

/**
 * Delete task files
 */
export async function deleteTaskFiles(taskId) {
  const taskDir = path.join(OUTPUT_DIR, taskId)
  const zipPath = path.join(OUTPUT_DIR, `${taskId}.zip`)
  
  try {
    await fs.rm(taskDir, { recursive: true, force: true })
    await fs.rm(zipPath, { force: true })
    
    // Remove from database
    await db.query('DELETE FROM task_files WHERE task_id = $1', [taskId])
    
    console.log(`[Files] Deleted files for task: ${taskId}`)
  } catch (error) {
    console.error(`[Files] Error deleting files:`, error)
  }
}

/**
 * Clean up old task files
 * 
 * TODO: Implement cleanup job
 * - Delete files older than X days
 * - Run periodically
 */
export async function cleanupOldFiles(maxAgeDays = 7) {
  // TODO: Implement cleanup
  //
  // const cutoff = new Date()
  // cutoff.setDate(cutoff.getDate() - maxAgeDays)
  //
  // const result = await db.query(`
  //   SELECT DISTINCT task_id FROM tasks
  //   WHERE completed_at < $1 OR (status = 'failed' AND created_at < $1)
  // `, [cutoff])
  //
  // for (const row of result.rows) {
  //   await deleteTaskFiles(row.task_id)
  // }
}

export default {
  saveFile,
  saveTaskFiles,
  packageResult,
  deployPreview,
  readTaskFile,
  listTaskFiles,
  deleteTaskFiles,
  cleanupOldFiles
}
