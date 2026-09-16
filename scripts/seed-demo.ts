/**
 * Loads demo/example-project into the development database so the app starts
 * with something to ask questions about.
 *
 *   npm run seed:demo            # retrieval only
 *   npm run seed:demo -- ollama qwen3.5:2b
 *   npm run seed:demo -- gguf /path/to/model.gguf
 */
import path from 'node:path'
import { openDatabase } from '../src/main/database/client'
import { upsertProject, writeSetting, projectStats } from '../src/main/database/repositories'
import { indexProject } from '../src/main/ingestion/indexer'
import { saveSettings } from '../src/main/settings'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const root = path.resolve(import.meta.dirname, '..')
const demoRoot = path.join(root, 'demo', 'example-project')
const db = openDatabase(path.join(root, 'data', 'docmind.db'))

const project = upsertProject(db, demoRoot, 'example-project')
const report = await indexProject(db, {
  projectId: project.id,
  root: demoRoot,
  settings: DEFAULT_SETTINGS.general
})
writeSetting(db, 'app.currentProjectId', String(project.id))

const [provider, value] = process.argv.slice(2)
if (provider === 'ollama' && value) saveSettings(db, { model: { provider: 'ollama', ollamaModel: value } })
if (provider === 'gguf' && value) saveSettings(db, { model: { provider: 'local-gguf', modelPath: value } })

console.log(`seeded ${demoRoot}`)
console.log(report)
console.log(projectStats(db, project.id))
db.close()
