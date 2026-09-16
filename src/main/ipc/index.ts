import path from 'node:path'
import fs from 'node:fs/promises'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { CHANNELS, type AppInfo, type AskInput } from '@shared/ipc'
import type {
  AskResult,
  ChatMessage,
  ConversationSummary,
  DocumentDetail,
  DocumentSummary,
  GgufFileInfo,
  IndexReport,
  ModelStatus,
  OllamaModelInfo,
  ProjectSummary,
  Result,
  Settings
} from '@shared/types'
import {
  createConversation,
  deleteConversation,
  deleteProject,
  getProject,
  listConversations,
  listDocuments,
  listMessages,
  listProjects,
  listSections,
  projectStats,
  upsertProject
} from '../database/repositories'
import { documents } from '../database/schema'
import { eq } from 'drizzle-orm'
import { assertReadableDirectory, readTextFile } from '../filesystem/scanner'
import { indexProject } from '../ingestion/indexer'
import { inspectGguf } from '../llm/gguf'
import { listOllamaModels } from '../llm/ollama'
import { runAsk } from '../retrieval/pipeline'
import type { Services } from '../services'

type Send = (channel: string, payload: unknown) => void

async function safe<T>(action: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, data: await action() }
  } catch (error) {
    const err = error as Error & { code?: string }
    console.error('[docmind:ipc]', err)
    return { ok: false, error: err.message || String(error), code: err.code }
  }
}

export function registerIpc(services: Services, getWindow: () => BrowserWindow | null): void {
  const send: Send = (channel, payload) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  services.models.onStatusChange((status: ModelStatus) => send(CHANNELS.eventModelStatus, status))

  let activeRun: AbortController | null = null

  const summarize = (id: number): ProjectSummary => {
    const project = getProject(services.db, id)
    if (!project) throw new Error(`Project ${id} no longer exists.`)
    return { ...project, stats: projectStats(services.db, id) }
  }

  const openProject = async (folder: string): Promise<ProjectSummary> => {
    await assertReadableDirectory(folder)
    const project = upsertProject(services.db, folder, path.basename(folder) || folder)
    services.setCurrentProjectId(project.id)

    const report = await indexProject(services.db, {
      projectId: project.id,
      root: folder,
      settings: services.settings().general,
      onProgress: (progress) => send(CHANNELS.eventIndex, progress)
    })
    if (report.added + report.changed + report.unchanged === 0) {
      throw new Error(
        `No documentation files (${services.settings().general.extensions.join(', ')}) were found in ${folder}.`
      )
    }
    return summarize(project.id)
  }

  /* ------------------------------- app ------------------------------- */
  ipcMain.handle(CHANNELS.appInfo, () =>
    safe<AppInfo>(() => ({
      version: app.getVersion(),
      databasePath: services.databasePath,
      platform: process.platform,
      electron: process.versions.electron ?? ''
    }))
  )

  /* ----------------------------- projects ---------------------------- */
  ipcMain.handle(CHANNELS.projectOpenDialog, () =>
    safe<ProjectSummary | null>(async () => {
      const window = getWindow()
      const result = window
        ? await dialog.showOpenDialog(window, {
            title: 'Open documentation folder',
            properties: ['openDirectory', 'createDirectory']
          })
        : await dialog.showOpenDialog({ properties: ['openDirectory'] })
      const folder = result.filePaths[0]
      if (result.canceled || !folder) return null
      return openProject(folder)
    })
  )

  ipcMain.handle(CHANNELS.projectOpenPath, (_e, folder: string) => safe(() => openProject(folder)))

  ipcMain.handle(CHANNELS.projectList, () => safe<ProjectSummary[]>(() => listProjects(services.db)))

  ipcMain.handle(CHANNELS.projectCurrent, () =>
    safe<ProjectSummary | null>(() => {
      const id = services.currentProjectId()
      if (id === null) return null
      const project = getProject(services.db, id)
      return project ? { ...project, stats: projectStats(services.db, id) } : null
    })
  )

  ipcMain.handle(CHANNELS.projectSelect, (_e, projectId: number) =>
    safe(() => {
      const summary = summarize(projectId)
      services.setCurrentProjectId(projectId)
      return summary
    })
  )

  ipcMain.handle(CHANNELS.projectReindex, (_e, projectId: number) =>
    safe<IndexReport>(async () => {
      const project = getProject(services.db, projectId)
      if (!project) throw new Error(`Project ${projectId} no longer exists.`)
      await assertReadableDirectory(project.path)
      return indexProject(services.db, {
        projectId,
        root: project.path,
        settings: services.settings().general,
        onProgress: (progress) => send(CHANNELS.eventIndex, progress)
      })
    })
  )

  ipcMain.handle(CHANNELS.projectRemove, (_e, projectId: number) =>
    safe<null>(() => {
      deleteProject(services.db, projectId)
      if (services.currentProjectId() === projectId) services.setCurrentProjectId(null)
      return null
    })
  )

  /* ---------------------------- documents ---------------------------- */
  ipcMain.handle(CHANNELS.documentList, (_e, projectId: number) =>
    safe<DocumentSummary[]>(() => listDocuments(services.db, projectId))
  )

  ipcMain.handle(CHANNELS.documentGet, (_e, documentId: number) =>
    safe<DocumentDetail>(async () => {
      const row = services.db.orm.select().from(documents).where(eq(documents.id, documentId)).get()
      if (!row) throw new Error(`Document ${documentId} is not in the index.`)
      const project = getProject(services.db, row.projectId)
      if (!project) throw new Error('The owning project no longer exists.')

      const absolute = path.join(project.path, row.relativePath)
      let content: string
      try {
        content = await readTextFile(absolute)
      } catch {
        // The file may have been moved since indexing: fall back to the
        // stored sections so the viewer still shows something useful.
        content = listSections(services.db, documentId)
          .map((section) => `## ${section.heading}\n\n${section.content}`)
          .join('\n\n')
      }
      return {
        id: row.id,
        relativePath: row.relativePath,
        filename: row.filename,
        content,
        sections: listSections(services.db, documentId)
      }
    })
  )

  /* ------------------------------- chat ------------------------------ */
  ipcMain.handle(CHANNELS.chatConversations, (_e, projectId: number) =>
    safe<ConversationSummary[]>(() => listConversations(services.db, projectId))
  )

  ipcMain.handle(CHANNELS.chatCreateConversation, (_e, projectId: number, title: string) =>
    safe<ConversationSummary>(() => {
      const id = createConversation(services.db, projectId, title || 'New conversation')
      const found = listConversations(services.db, projectId).find((c) => c.id === id)
      if (!found) throw new Error('Could not create the conversation.')
      return found
    })
  )

  ipcMain.handle(CHANNELS.chatDeleteConversation, (_e, conversationId: number) =>
    safe<null>(() => {
      deleteConversation(services.db, conversationId)
      return null
    })
  )

  ipcMain.handle(CHANNELS.chatMessages, (_e, conversationId: number) =>
    safe<ChatMessage[]>(() => listMessages(services.db, conversationId))
  )

  ipcMain.handle(CHANNELS.chatAsk, (_e, input: AskInput) =>
    safe<AskResult>(async () => {
      const question = input.question.trim()
      if (question === '') throw new Error('The question is empty.')

      const projectId = services.currentProjectId()
      if (projectId === null) throw new Error('No project is open.')

      let conversationId = input.conversationId
      if (conversationId === null) {
        conversationId = createConversation(services.db, projectId, question)
      }

      activeRun?.abort()
      const controller = new AbortController()
      activeRun = controller

      try {
        return await runAsk({
          db: services.db,
          projectId,
          conversationId,
          question,
          settings: services.settings(),
          models: services.models,
          emit: (event) => send(CHANNELS.eventPipeline, event),
          signal: controller.signal
        })
      } finally {
        if (activeRun === controller) activeRun = null
      }
    })
  )

  ipcMain.handle(CHANNELS.chatCancel, () =>
    safe<null>(() => {
      activeRun?.abort()
      activeRun = null
      return null
    })
  )

  /* ------------------------------ models ----------------------------- */
  ipcMain.handle(CHANNELS.modelStatus, () => safe<ModelStatus>(() => services.models.status()))

  ipcMain.handle(CHANNELS.modelChooseGguf, () =>
    safe<GgufFileInfo | null>(async () => {
      const window = getWindow()
      const options = {
        title: 'Select a GGUF model',
        properties: ['openFile' as const],
        filters: [{ name: 'GGUF model', extensions: ['gguf'] }]
      }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      const file = result.filePaths[0]
      if (result.canceled || !file) return null
      return inspectGguf(file)
    })
  )

  ipcMain.handle(CHANNELS.modelInspect, (_e, filePath: string) => safe<GgufFileInfo>(() => inspectGguf(filePath)))

  ipcMain.handle(CHANNELS.modelOllamaList, (_e, baseUrl: string) =>
    safe<OllamaModelInfo[]>(() => listOllamaModels(baseUrl || services.settings().model.ollamaUrl))
  )

  ipcMain.handle(CHANNELS.modelLoad, () =>
    safe<ModelStatus>(async () => {
      await services.models.ensureReady()
      return services.models.status()
    })
  )

  ipcMain.handle(CHANNELS.modelUnload, () =>
    safe<ModelStatus>(async () => {
      await services.models.unload()
      return services.models.status()
    })
  )

  /* ----------------------------- settings ---------------------------- */
  ipcMain.handle(CHANNELS.settingsGet, () => safe<Settings>(() => services.settings()))
  ipcMain.handle(CHANNELS.settingsUpdate, (_e, patch: unknown) => safe<Settings>(() => services.updateSettings(patch)))

  /* ------------------------------ misc ------------------------------- */
  ipcMain.handle('shell:show-item', (_e, target: string) =>
    safe<null>(async () => {
      await fs.access(target)
      shell.showItemInFolder(target)
      return null
    })
  )
}
