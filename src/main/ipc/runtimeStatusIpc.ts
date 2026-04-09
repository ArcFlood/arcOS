import os from 'os'
import { shell, type IpcMain } from 'electron'
import { writeChainArtifact, type ChainArtifact } from '../chainHistory'
import { analyzeWithOpenClaw, type OpenClawAnalysisRequest } from '../integrations/openclaw/analysis'
import { loadOpenClawContext } from '../integrations/openclaw/runtime'
import { requireHttpUrl, requireObject, requireString, optionalString } from './validation'
import { getCodingRuntimeStatus, resolveActiveRepositoryPath } from '../services/codingRuntimeStatus'
import { getHestiaSystemMetrics, type HestiaSystemMetrics } from '../services/hestiaMetrics'
import { deleteOllamaModel, listOllamaModelDetails, listOllamaModels } from '../services/ollamaModels'
import { loadArcPrompts } from '../services/paiPrompts'
import { getPlatformUpdateCheck } from '../services/platformUpdates'
import { getServiceStatus, startService, stopService } from '../services/serviceControl'
import { getVoiceServerStatus, sendVoiceNotification, synthesizeElevenLabsAudio } from '../services/voiceService'

type RuntimeStatusIpcDeps = {
  appPath: string
  getCodingRuntimePaths: () => {
    appPath: string
    dirname: string
    cwd: string
    environment: 'development' | 'packaged'
  }
  findOpenClawRuntime: () => unknown
  enforceExecutePermission: (action: string) => unknown
}

export function registerRuntimeStatusIpc(ipcMain: IpcMain, deps: RuntimeStatusIpcDeps): void {
  ipcMain.handle('load-arc-prompts', async () => {
    return loadArcPrompts()
  })

  ipcMain.handle('ollama-list-models', async () => {
    return listOllamaModels()
  })

  ipcMain.handle('ollama-list-model-details', async () => {
    return listOllamaModelDetails()
  })

  ipcMain.handle('service-status', (_event, requestedName: unknown) => getServiceStatus(requestedName))
  ipcMain.handle('service-start', (_event, requestedName: unknown) => startService(requestedName))
  ipcMain.handle('service-stop', (_event, requestedName: unknown) => stopService(requestedName))

  ipcMain.handle('open-external', (_event, requestedUrl: unknown) => {
    try {
      shell.openExternal(requireHttpUrl(requestedUrl, 'external URL'))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('openclaw-context', () => {
    try {
      return { success: true, ...loadOpenClawContext() }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('openclaw:analyze', async (_event, request: OpenClawAnalysisRequest) => {
    try {
      const result = await analyzeWithOpenClaw(request)
      return { success: true, ...result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('chain:capture-save', (_event, artifact: ChainArtifact) => {
    try {
      const filePath = writeChainArtifact(artifact)
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('open-path', (_event, requestedPath: unknown) => {
    try {
      const targetPath = requireString(requestedPath, 'target path', 4096)
      const error = shell.openPath(targetPath)
      return Promise.resolve(error).then((result) => ({
        success: result.length === 0,
        error: result || undefined,
      }))
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('voice:status', async () => {
    return getVoiceServerStatus()
  })

  ipcMain.handle('voice:notify', async (_event, params: unknown) => {
    try {
      const payload = requireObject(params, 'voice notification payload')
      return sendVoiceNotification({
        message: requireString(payload.message, 'voice message', 10_000),
        title: optionalString(payload.title, 'voice title', 200),
        voiceId: optionalString(payload.voiceId, 'voice id', 200),
      })
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('voice:synthesize', async (_event, params: unknown) => {
    try {
      const payload = requireObject(params, 'voice synthesis payload')
      return synthesizeElevenLabsAudio({
        message: requireString(payload.message, 'voice message', 10_000),
        voiceId: optionalString(payload.voiceId, 'voice id', 200),
      })
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('coding-runtime:status', async () => {
    try {
      return { success: true, status: await getCodingRuntimeStatus(deps.getCodingRuntimePaths()) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('platform-updates:check', async () => {
    try {
      return await getPlatformUpdateCheck(deps.findOpenClawRuntime)
    } catch (e) {
      return {
        success: false,
        checkedAt: new Date().toISOString(),
        policy: 'check-only-manual-approval' as const,
        targets: [],
        error: String(e),
      }
    }
  })

  ipcMain.handle('hestia:system-metrics', async () => {
    try {
      return await getHestiaSystemMetrics(await resolveActiveRepositoryPath(deps.getCodingRuntimePaths()) ?? deps.appPath)
    } catch (e) {
      return {
        success: false,
        sampledAt: Date.now(),
        platform: process.platform,
        hostname: os.hostname(),
        uptimeSeconds: 0,
        bootTimeIso: new Date().toISOString(),
        cpu: { model: 'unknown', coreCount: 0, loadAverage: [], totalPercent: 0, cores: [] },
        memory: { totalBytes: 0, freeBytes: 0, usedBytes: 0, usedPercent: 0 },
        disks: [],
        network: [],
        topProcesses: [],
        sensors: { available: false, detail: 'Sensor data unavailable.', temperatures: [], fans: [], power: [], current: [], voltage: [], battery: [] },
        error: String(e),
      } satisfies HestiaSystemMetrics
    }
  })

  ipcMain.handle('ollama-delete-model', async (_event, requestedModelName: unknown) => {
    try {
      const modelName = requireString(requestedModelName, 'model name', 200)
      const denied = deps.enforceExecutePermission(`deleting Ollama model ${modelName}`)
      if (denied) return denied
      return await deleteOllamaModel(modelName)
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('tools:list', () => {
    // The actual tool definitions live in renderer/utils/tools.ts.
    // Main process returns a success acknowledgement; renderer assembles final list.
    return { success: true, builtinCount: 20 }
  })
}
