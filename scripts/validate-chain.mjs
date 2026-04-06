#!/usr/bin/env node
/* eslint-env node */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const runtimePath = (() => {
  const extraPaths = [
    `${os.homedir()}/.local/bin`,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  const current = process.env.PATH ?? ''
  const existing = new Set(current.split(':').filter(Boolean))
  const prepend = extraPaths.filter((entry) => !existing.has(entry))
  return [...prepend, current].filter(Boolean).join(':')
})()

const contextFiles = ['AGENTS.md', 'SOUL.md', 'MEMORY.md', 'HEARTBEAT.md']
const nonChatModelPatterns = [
  /embed/i,
  /embedding/i,
  /nomic-embed/i,
  /mxbai-embed/i,
  /snowflake-arctic-embed/i,
  /all-minilm/i,
  /bge-/i,
  /\be5-/i,
]

const validationCases = [
  {
    id: 'coding_audit',
    prompt: 'Please audit this React component for bugs and refactor issues.',
  },
  {
    id: 'fabric_candidate',
    prompt: [
      'Extract the key ideas, summarize the argument, and pull the most actionable insights from the following design note.',
      '',
      'ARCOS is the operating surface for PAI. Requests should move through PAI core context, OpenClaw, Fabric when appropriate, the Response Composer, and then the local model. The goal is not a generic chat app. The goal is a visible control plane where runtime stages are inspectable and corrections are easy to make.',
    ].join('\n'),
  },
]

const FABRIC_PATTERN_ALIASES = {
  code_review: ['review_code', 'explain_code', 'coding_master'],
  code_reviewer: ['review_code', 'explain_code', 'coding_master'],
  prompt_rebuilder: ['improve_prompt', 'summarize_prompt', 'create_pattern'],
  prompt_rebuild: ['improve_prompt', 'summarize_prompt', 'create_pattern'],
  control_plane: ['summarize', 'create_summary', 'extract_wisdom'],
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function truncate(text, max = 2400) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`
}

function normalizePatternId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function pickArcPromptSource() {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.claude', 'Skills', 'CORE', 'SKILL.md'),
    path.join(home, 'PAI', '.claude', 'Skills', 'CORE', 'SKILL.md'),
    path.join(home, 'Documents', 'PAI', '.claude', 'Skills', 'CORE', 'SKILL.md'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        source: candidate,
        prompt: fs.readFileSync(candidate, 'utf8'),
      }
    }
  }

  return {
    source: 'fallback',
    prompt: 'You are A.R.C. (AI Reasoning Companion), a helpful, precise AI assistant.',
  }
}

function getOpenClawSettings() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  const raw = readJson(configPath)
  const gatewayPort = raw?.gateway?.port ?? 18789
  const bind = raw?.gateway?.bind ?? 'loopback'
  const bindHost = bind === 'loopback' ? '127.0.0.1' : bind
  const workspacePath = raw?.agents?.defaults?.workspace ?? path.join(os.homedir(), '.openclaw', 'workspace')

  return {
    configPath,
    rawConfig: raw,
    workspacePath,
    gatewayPort,
    bindHost,
    token: raw?.gateway?.auth?.token,
    password: raw?.gateway?.auth?.password,
  }
}

function inspectOpenClawConfigWarnings(rawConfig) {
  const warnings = []
  const defaults = rawConfig?.agents?.defaults
  if (defaults?.model && typeof defaults.model === 'object' && !Array.isArray(defaults.model)) {
    if ('idleTimeoutMs' in defaults.model || 'requestTimeoutMs' in defaults.model) {
      warnings.push('~/.openclaw/openclaw.json uses unsupported timeout keys under agents.defaults.model; OpenClaw expects agents.defaults.llm.idleTimeoutSeconds and agents.defaults.timeoutSeconds instead.')
    }
  }
  if (defaults?.models && typeof defaults.models === 'object') {
    for (const [modelName, value] of Object.entries(defaults.models)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      if ('idleTimeoutMs' in value || 'requestTimeoutMs' in value) {
        warnings.push(`~/.openclaw/openclaw.json uses unsupported timeout keys under agents.defaults.models.${modelName}; those keys are ignored by current OpenClaw schema.`)
      }
    }
  }
  return warnings
}

function buildValidationOpenClawConfig(rawConfig) {
  const sanitized = JSON.parse(JSON.stringify(rawConfig))
  const defaults = sanitized?.agents?.defaults
  if (!defaults || typeof defaults !== 'object') return sanitized

  const model = defaults.model
  if (model && typeof model === 'object' && !Array.isArray(model)) {
    defaults.model = typeof model.primary === 'string'
      ? { primary: model.primary, ...(Array.isArray(model.fallbacks) ? { fallbacks: model.fallbacks } : {}) }
      : model
  }

  if (defaults.models && typeof defaults.models === 'object') {
    for (const [key, value] of Object.entries(defaults.models)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = {}
      if (typeof value.alias === 'string') entry.alias = value.alias
      if (value.params && typeof value.params === 'object' && !Array.isArray(value.params)) entry.params = value.params
      if (typeof value.streaming === 'boolean') entry.streaming = value.streaming
      defaults.models[key] = entry
    }
  }

  const idleTimeoutMs = typeof model?.idleTimeoutMs === 'number' ? model.idleTimeoutMs : 300000
  const requestTimeoutMs = typeof model?.requestTimeoutMs === 'number' ? model.requestTimeoutMs : 300000
  defaults.llm = {
    ...(defaults.llm ?? {}),
    idleTimeoutSeconds: Math.max(1, Math.round(idleTimeoutMs / 1000)),
  }
  defaults.timeoutSeconds = Math.max(1, Math.round(requestTimeoutMs / 1000))
  return sanitized
}

function loadOpenClawContext(workspacePath) {
  return contextFiles.flatMap((fileName) => {
    const filePath = path.join(workspacePath, fileName)
    if (!fs.existsSync(filePath)) return []
    return [{
      name: fileName,
      path: filePath,
      content: fs.readFileSync(filePath, 'utf8').slice(0, 4000),
    }]
  })
}

function compareSemverDesc(a, b) {
  const normalize = (value) => value.replace(/^v/, '').split('.').map((part) => Number(part) || 0)
  const aParts = normalize(a)
  const bParts = normalize(b)
  const max = Math.max(aParts.length, bParts.length)
  for (let index = 0; index < max; index += 1) {
    const delta = (bParts[index] ?? 0) - (aParts[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function findOpenClawRuntime() {
  const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node')
  if (!fs.existsSync(nvmBase)) {
    throw new Error(`OpenClaw runtime not found under ${nvmBase}`)
  }

  const versions = fs.readdirSync(nvmBase).sort(compareSemverDesc)
  for (const version of versions) {
    const base = path.join(nvmBase, version)
    const nodePath = path.join(base, 'bin', 'node')
    const openClawPath = path.join(base, 'lib', 'node_modules', 'openclaw', 'openclaw.mjs')
    const distDir = path.join(base, 'lib', 'node_modules', 'openclaw', 'dist')
    const callModule = fs.existsSync(distDir)
      ? fs.readdirSync(distDir).find((entry) => /^call-.*\.js$/.test(entry))
      : null
    if (fs.existsSync(nodePath) && fs.existsSync(openClawPath) && callModule) {
      return {
        nodePath,
        openClawPath,
        callModulePath: path.join(distDir, callModule),
        version,
      }
    }
  }

  throw new Error('Unable to locate a Node 22.12+ OpenClaw runtime under ~/.nvm/versions/node')
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      PATH: runtimePath,
      HOME: process.env.HOME ?? os.homedir(),
    },
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const detail = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n')
    throw new Error(detail || `${command} exited with status ${result.status ?? 'unknown'}`)
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function runOpenClawGatewayCall(runtime, method, params, timeoutMs = 300000) {
  const args = [
    runtime.openClawPath,
    'gateway',
    'call',
    method,
    '--json',
    '--timeout',
    String(timeoutMs),
    '--params',
    JSON.stringify(params ?? {}),
  ]

  const result = runCommand(runtime.nodePath, args, {
    cwd: repoRoot,
  })

  return JSON.parse(result.stdout)
}

function extractOpenClawMessageText(message) {
  if (!message || typeof message !== 'object') return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''

  return message.content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      return part.type === 'text' && typeof part.text === 'string' ? part.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null
  return text.slice(firstBrace, lastBrace + 1).trim()
}

function buildFabricPatternUrlCandidates(pattern, input) {
  const encoded = encodeURIComponent(pattern)
  return [
    {
      url: `http://localhost:8080/api/pattern/${encoded}`,
      contentType: 'text/plain',
      body: input,
    },
    {
      url: `http://localhost:8080/pattern/${encoded}`,
      contentType: 'text/plain',
      body: input,
    },
    {
      url: 'http://localhost:8080/api/run',
      contentType: 'application/json',
      body: JSON.stringify({ pattern, input }),
    },
  ]
}

function isChatCapableOllamaModel(model) {
  return !nonChatModelPatterns.some((pattern) => pattern.test(model))
}

async function listOllamaModels() {
  const response = await fetch('http://127.0.0.1:11434/api/tags', {
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) {
    throw new Error(`Ollama tags request failed (${response.status})`)
  }
  const data = await response.json()
  return (data.models ?? []).map((model) => model.name)
}

async function listFabricPatterns() {
  const result = runCommand('fabric', ['--listpatterns', '--shell-complete-list'])
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function resolveFabricPattern(requestedPattern, installedPatterns) {
  const normalizedInstalled = new Map(
    installedPatterns.map((pattern) => [normalizePatternId(pattern), pattern])
  )
  const normalizedRequested = normalizePatternId(requestedPattern)
  if (!normalizedRequested) return null
  if (normalizedInstalled.has(normalizedRequested)) {
    return normalizedInstalled.get(normalizedRequested) ?? null
  }
  const aliases = FABRIC_PATTERN_ALIASES[normalizedRequested] ?? []
  for (const alias of aliases) {
    const resolved = normalizedInstalled.get(normalizePatternId(alias))
    if (resolved) return resolved
  }
  return null
}

async function runOllamaChat(model, systemPrompt, userPrompt) {
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(300000),
  })

  if (!response.ok) {
    throw new Error(`Ollama chat failed (${response.status}): ${await response.text()}`)
  }

  const data = await response.json()
  return {
    model,
    response: data?.message?.content ?? '',
    evalCount: data?.eval_count ?? null,
    promptEvalCount: data?.prompt_eval_count ?? null,
  }
}

async function runFabricPattern(pattern, input) {
  for (const candidate of buildFabricPatternUrlCandidates(pattern, input)) {
    try {
      const response = await fetch(candidate.url, {
        method: 'POST',
        headers: { 'Content-Type': candidate.contentType },
        body: candidate.body,
        signal: AbortSignal.timeout(45000),
      })
      if (!response.ok) {
        if (response.status === 404) continue
        const detail = await response.text()
        throw new Error(`Fabric server error (${response.status}): ${detail}`)
      }
      const output = (await response.text()).trim()
      if (output) {
        return { mode: 'server', stage: 'Fabric', output }
      }
    } catch (error) {
      if (String(error).includes('404')) continue
    }
  }

  try {
    const cliResult = runCommand('fabric', ['--pattern', pattern], { input })
    return {
      executed: true,
      mode: 'cli',
      stage: 'Fabric',
      output: cliResult.stdout.trim(),
      error: null,
    }
  } catch (error) {
    return {
      executed: false,
      mode: 'cli',
      stage: 'Fabric',
      output: '',
      error: String(error),
    }
  }
}

function buildConversationSection() {
  return 'No prior conversation history.'
}

function buildMemorySection() {
  return 'No ARC-Memory citations staged for this request.'
}

function buildPluginSummary() {
  return 'No active plugin.'
}

function buildOpenClawMessage({ prompt, conversationSection, memorySection, pluginSummary }) {
  return [
    'You are the OpenClaw gateway stage for ARCOS.',
    'Analyze the request for orchestration only. Do not answer the user directly.',
    'Return strict JSON with these keys only:',
    '{',
    '  "summary": string,',
    '  "intent": string,',
    '  "workflow": string,',
    '  "recommended_tier": "ollama" | "haiku" | "arc-sonnet" | "arc-opus" | null,',
    '  "recommended_model": string | null,',
    '  "should_use_fabric": boolean,',
    '  "fabric_pattern": string | null,',
    '  "confidence": number | null,',
    '  "reasoning": string,',
    '  "notes": string[]',
    '}',
    '',
    '## User Prompt',
    prompt,
    '',
    '## Recent Conversation Context',
    conversationSection,
    '',
    '## Memory Context',
    memorySection,
    '',
    '## Plugin Context',
    pluginSummary,
  ].join('\n')
}

async function analyzeCase(testCase, shared) {
  const conversationSection = buildConversationSection()
  const memorySection = buildMemorySection()
  const pluginSummary = buildPluginSummary()
  const sessionKey = `arcos-chain-validation:${testCase.id}:${Date.now()}`
  const message = buildOpenClawMessage({
    prompt: testCase.prompt,
    conversationSection,
    memorySection,
    pluginSummary,
  })

  const send = runOpenClawGatewayCall(
    shared.runtime,
    'chat.send',
    {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: crypto.randomUUID(),
      timeoutMs: 300000,
    },
  )

  const runId = typeof send?.runId === 'string' ? send.runId : ''
  if (!runId) {
    throw new Error(`OpenClaw did not return a runId for ${testCase.id}`)
  }

  const wait = runOpenClawGatewayCall(
    shared.runtime,
    'agent.wait',
    {
      runId,
      timeoutMs: 300000,
    },
  )

  const history = runOpenClawGatewayCall(
    shared.runtime,
    'chat.history',
    {
      sessionKey,
      limit: 12,
      maxChars: 24000,
    },
  )

  const messages = Array.isArray(history?.messages) ? history.messages : []
  const lastAssistant = [...messages]
    .reverse()
    .find((entry) => entry && typeof entry === 'object' && entry.role === 'assistant')
  const raw = extractOpenClawMessageText(lastAssistant)
  const jsonText = extractJsonObject(raw)
  if (!jsonText) {
    throw new Error(`OpenClaw returned no parseable JSON for ${testCase.id}`)
  }

  const analysis = JSON.parse(jsonText)
  const openClawContext = loadOpenClawContext(shared.settings.workspacePath)
  const openClawContextBlock = openClawContext.length === 0
    ? 'No OpenClaw workspace context files were available.'
    : openClawContext.map((file) => `# ${file.name}\n${file.content}`).join('\n\n')

  let chainPath = 'openclaw-only'
  const installedFabricPatterns = await listFabricPatterns()
  const resolvedFabricPattern = resolveFabricPattern(analysis?.fabric_pattern ?? null, installedFabricPatterns)
  let fabricResult = {
    executed: false,
    pattern: analysis?.fabric_pattern ?? null,
    resolvedPattern: resolvedFabricPattern,
    mode: null,
    stage: null,
    output: 'No Fabric transformation was applied.',
    error: null,
  }

  if (analysis?.should_use_fabric && resolvedFabricPattern) {
    const fabricInput = [
      testCase.prompt,
      '',
      '## Recent Conversation Context',
      conversationSection,
      '',
      '## Memory Context',
      memorySection,
    ].join('\n')
    const executed = await runFabricPattern(resolvedFabricPattern, fabricInput)
    if (executed.executed) {
      chainPath = 'openclaw-plus-fabric'
      fabricResult = {
        executed: true,
        pattern: analysis.fabric_pattern,
        resolvedPattern: resolvedFabricPattern,
        mode: executed.mode,
        stage: executed.stage,
        output: executed.output,
        error: null,
      }
    } else {
      chainPath = 'degraded-fallback'
      fabricResult = {
        executed: false,
        pattern: analysis.fabric_pattern,
        resolvedPattern: resolvedFabricPattern,
        mode: executed.mode,
        stage: executed.stage,
        output: `Fabric execution failed for pattern "${resolvedFabricPattern}".`,
        error: executed.error,
      }
    }
  } else if (analysis?.should_use_fabric && analysis?.fabric_pattern && !resolvedFabricPattern) {
    chainPath = 'degraded-fallback'
    fabricResult = {
      executed: false,
      pattern: analysis.fabric_pattern,
      resolvedPattern: null,
      mode: null,
      stage: 'Fabric',
      output: `Fabric execution failed for pattern "${analysis.fabric_pattern}".`,
      error: `No installed Fabric pattern matched "${analysis.fabric_pattern}"`,
    }
  }

  const openClawAnalysisBlock = [
    `Summary: ${analysis.summary ?? 'n/a'}`,
    `Intent: ${analysis.intent ?? 'n/a'}`,
    `Workflow: ${analysis.workflow ?? 'n/a'}`,
    `Recommended tier: ${analysis.recommended_tier ?? 'none'}`,
    `Recommended model: ${analysis.recommended_model ?? 'none'}`,
    `Fabric: ${analysis.should_use_fabric ? `yes${analysis.fabric_pattern ? ` (${analysis.fabric_pattern})` : ''}` : 'no'}`,
    `Confidence: ${analysis.confidence ?? 'n/a'}`,
    `Reasoning: ${analysis.reasoning ?? 'n/a'}`,
    analysis.notes?.length ? `Notes: ${analysis.notes.join(' | ')}` : '',
  ].filter(Boolean).join('\n')

  const rebuiltSystemPrompt = [
    shared.arcPrompt.prompt,
    '',
    '## PAI Core Context',
    '',
    `Active plugin: none`,
    `Plugin target stages: none`,
    '',
    '### Recent Thread Context',
    conversationSection,
    '',
    '### ARC-Memory Context',
    memorySection,
    '',
    '### OpenClaw Workspace Context',
    openClawContextBlock,
    '',
    '### OpenClaw Gateway Analysis',
    openClawAnalysisBlock,
    '',
    '### Fabric Output',
    fabricResult.output,
    '',
    '## Execution Requirement',
    'You are responding through the ARCOS canonical execution chain. Respect the PAI context above when producing the response.',
  ].join('\n')

  const rebuiltUserPrompt = [
    testCase.prompt,
    '',
    '## Request Handling Note',
    'The response must remain consistent with the PAI core context, OpenClaw workspace context, and any staged memory supplied above.',
  ].join('\n')

  const availableModels = (await listOllamaModels()).filter(isChatCapableOllamaModel)
  if (availableModels.length === 0) {
    throw new Error('No chat-capable Ollama models are installed')
  }

  const localModel = analysis?.recommended_tier === 'ollama' && analysis?.recommended_model
    ? analysis.recommended_model
    : availableModels[0]

  const modelDispatch = await runOllamaChat(localModel, rebuiltSystemPrompt, rebuiltUserPrompt)

  return {
    id: testCase.id,
    prompt: testCase.prompt,
    conversationSection,
    memorySection,
    pluginSummary,
    sessionKey,
    runId,
    waitStatus: wait?.status ?? 'unknown',
    chainPath,
    openClaw: {
      raw,
      analysis,
      workspaceFiles: openClawContext.map((file) => file.name),
    },
    fabric: fabricResult,
    promptRebuilder: {
      rebuiltSystemPrompt,
      rebuiltUserPrompt,
      rebuiltSystemPromptLength: rebuiltSystemPrompt.length,
      rebuiltUserPromptLength: rebuiltUserPrompt.length,
    },
    modelDispatch,
  }
}

function buildMarkdownReport(report) {
  const lines = [
    '# ARCOS Chain Validation',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Cases run: ${report.summary.caseCount}`,
    `- Cases with Fabric execution: ${report.summary.fabricExecutions}`,
    `- OpenClaw runtime: ${report.environment.openClaw.runtimeVersion}`,
    `- Local model used: ${report.summary.modelsUsed.join(', ') || 'none'}`,
    '',
  ]

  if (report.warnings.length > 0) {
    lines.push('## Runtime Warnings', '')
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`)
    }
    lines.push('')
  }

  for (const result of report.results) {
    lines.push(`## ${result.id}`, '')
    lines.push(`- Chain path: ${result.chainPath}`)
    lines.push(`- Recommended tier: ${result.openClaw.analysis.recommended_tier ?? 'none'}`)
    lines.push(`- Recommended model: ${result.openClaw.analysis.recommended_model ?? 'none'}`)
    lines.push(`- Fabric selected: ${result.fabric.pattern ?? 'none'}`)
    lines.push(`- Fabric executed: ${result.fabric.executed ? 'yes' : 'no'}`)
    lines.push(`- Fabric resolved: ${result.fabric.resolvedPattern ?? 'none'}`)
    if (result.fabric.error) {
      lines.push(`- Fabric error: ${result.fabric.error}`)
    }
    lines.push(`- Local model dispatch: ${result.modelDispatch.model}`)
    lines.push('', '### Prompt', '', '```text', result.prompt, '```', '')
    lines.push('### OpenClaw Analysis', '', '```json', JSON.stringify(result.openClaw.analysis, null, 2), '```', '')
    lines.push('### Fabric Output Preview', '', '```text', truncate(result.fabric.output), '```', '')
    lines.push('### Local Model Response Preview', '', '```text', truncate(result.modelDispatch.response), '```', '')
  }

  return lines.join('\n')
}

async function main() {
  const runtime = findOpenClawRuntime()
  const major = Number(process.versions.node.split('.')[0] ?? 0)
  if ((typeof WebSocket !== 'function' || major < 22) && process.env.ARCOS_CHAIN_VALIDATION_REEXEC !== '1') {
    const rerun = runCommand(runtime.nodePath, [__filename], {
      cwd: repoRoot,
      env: {
        ARCOS_CHAIN_VALIDATION_REEXEC: '1',
      },
    })
    if (rerun.stdout) process.stdout.write(rerun.stdout)
    if (rerun.stderr) process.stderr.write(rerun.stderr)
    return
  }

  const arcPrompt = pickArcPromptSource()
  const settings = getOpenClawSettings()
  const warnings = new Set(inspectOpenClawConfigWarnings(settings.rawConfig))
  const validationConfig = buildValidationOpenClawConfig(settings.rawConfig)
  const results = []

  for (const testCase of validationCases) {
    results.push(await analyzeCase(testCase, {
      arcPrompt,
      settings,
      runtime,
      validationConfig,
    }))
  }

  const outputDir = path.join(repoRoot, 'docs')
  ensureDir(outputDir)

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      repoRoot,
      arcPromptSource: arcPrompt.source,
      openClaw: {
        configPath: settings.configPath,
        workspacePath: settings.workspacePath,
        gatewayUrl: `ws://${settings.bindHost}:${settings.gatewayPort}`,
        runtimeVersion: runtime.version,
      },
    },
    warnings: [...warnings],
    summary: {
      caseCount: results.length,
      fabricExecutions: results.filter((result) => result.fabric.executed).length,
      modelsUsed: [...new Set(results.map((result) => result.modelDispatch.model))],
    },
    results,
  }

  const jsonPath = path.join(outputDir, 'CHAIN_VALIDATION_LATEST.json')
  const markdownPath = path.join(outputDir, 'CHAIN_VALIDATION_LATEST.md')
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(markdownPath, `${buildMarkdownReport(report)}\n`)

  process.stdout.write(`${jsonPath}\n${markdownPath}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? String(error)}\n`)
  process.exit(1)
})
