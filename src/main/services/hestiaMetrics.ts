import fs from 'fs'
import os from 'os'
import path from 'path'
import { runCommandAsync } from './commandRunner'

export type HestiaSystemMetrics = {
  success: boolean
  sampledAt: number
  platform: string
  hostname: string
  uptimeSeconds: number
  bootTimeIso: string
  cpu: {
    model: string
    coreCount: number
    loadAverage: number[]
    totalPercent: number
    cores: Array<{ index: number; percent: number }>
  }
  memory: {
    totalBytes: number
    freeBytes: number
    usedBytes: number
    usedPercent: number
  }
  disks: Array<{
    filesystem: string
    sizeBytes: number
    usedBytes: number
    availableBytes: number
    usedPercent: number
    mount: string
  }>
  network: Array<{
    interfaceName: string
    address?: string
    bytesIn?: number
    bytesOut?: number
  }>
  topProcesses: Array<{
    pid: number
    cpuPercent: number
    memoryPercent: number
    command: string
  }>
  sensors: {
    available: boolean
    detail: string
    temperatures: Array<{ name: string; valueCelsius: number }>
    fans: Array<{ name: string; rpm: number }>
    power: Array<{ name: string; watts: number }>
    current: Array<{ name: string; amps: number }>
    voltage: Array<{ name: string; volts: number }>
    battery: Array<{ name: string; value: string }>
  }
  error?: string
}

type CpuTimingSnapshot = { idle: number; total: number }
type ISMCSensorEntry = {
  key?: string
  value?: unknown
  quantity?: unknown
  unit?: string
}

let previousCpuSnapshot: CpuTimingSnapshot[] | null = null
let lastISMCError: string | null = null

function bytesFromKilobytes(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed * 1024 : 0
}

function cpuUsagePercent(cpu: os.CpuInfo, index: number, previous: CpuTimingSnapshot[] | null, current: CpuTimingSnapshot[]): number {
  const snapshot = current[index]
  if (!snapshot) return 0
  const previousSnapshot = previous?.[index]
  if (previousSnapshot) {
    const totalDelta = snapshot.total - previousSnapshot.total
    const idleDelta = snapshot.idle - previousSnapshot.idle
    if (totalDelta > 0) {
      return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100))
    }
  }
  const total = snapshot.total
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, ((total - cpu.times.idle) / total) * 100))
}

async function runLocalCommand(command: string, args: string[], cwd?: string): Promise<{ success: boolean; stdout: string; error?: string }> {
  const result = await runCommandAsync(command, args, { cwd, timeoutMs: 5000 })
  return { success: result.success, stdout: result.stdout, error: result.error || result.stderr || undefined }
}

async function getDiskMetrics(): Promise<HestiaSystemMetrics['disks']> {
  const result = await runLocalCommand('df', ['-kP'])
  if (!result.success) return []
  return result.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 6)
    .map((parts) => ({
      filesystem: parts[0] ?? 'unknown',
      sizeBytes: bytesFromKilobytes(parts[1] ?? '0'),
      usedBytes: bytesFromKilobytes(parts[2] ?? '0'),
      availableBytes: bytesFromKilobytes(parts[3] ?? '0'),
      usedPercent: Number.parseFloat((parts[4] ?? '0').replace('%', '')) || 0,
      mount: parts.slice(5).join(' ') || 'unknown',
    }))
    .filter((disk) => disk.sizeBytes > 0)
    .slice(0, 8)
}

async function getNetworkMetrics(): Promise<HestiaSystemMetrics['network']> {
  const interfaces = os.networkInterfaces()
  const networkResult = await runLocalCommand('netstat', ['-ibn'])
  const rows = networkResult.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 10)
  return Object.entries(interfaces)
    .flatMap(([interfaceName, entries]) => {
      const primary = entries?.find((entry) => entry.family === 'IPv4' && !entry.internal)
      if (!primary) return []
      const row = rows.find((parts) => parts[0] === interfaceName && parts[2] === primary.address)
      return [{
        interfaceName,
        address: primary.address,
        bytesIn: row ? Number.parseInt(row[6] ?? '0', 10) || undefined : undefined,
        bytesOut: row ? Number.parseInt(row[9] ?? '0', 10) || undefined : undefined,
      }]
    })
    .slice(0, 8)
}

async function getTopProcesses(): Promise<HestiaSystemMetrics['topProcesses']> {
  const result = await runLocalCommand('ps', ['-axo', 'pid=,pcpu=,pmem=,comm=', '-r'])
  if (!result.success) return []
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/)
      return {
        pid: Number.parseInt(parts[0] ?? '0', 10) || 0,
        cpuPercent: Number.parseFloat(parts[1] ?? '0') || 0,
        memoryPercent: Number.parseFloat(parts[2] ?? '0') || 0,
        command: parts.slice(3).join(' ') || 'unknown',
      }
    })
    .filter((processInfo) => processInfo.pid > 0)
    .slice(0, 8)
}

function parseISMCValue(entry: ISMCSensorEntry, unit: string): number | null {
  if (typeof entry.quantity === 'number' && Number.isFinite(entry.quantity)) return entry.quantity
  if (typeof entry.value === 'number' && Number.isFinite(entry.value)) return entry.value
  if (typeof entry.value === 'string') {
    const parsed = Number.parseFloat(entry.value.replace(unit, '').trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function runISMC(command: 'temp' | 'fans' | 'power' | 'all', projectRoot: string): Promise<unknown | null> {
  const repoBinary = path.join(projectRoot, 'iSMC', 'iSMC')
  const lowerRepoBinary = path.join(projectRoot, 'iSMC', 'ismc')
  const candidates = [
    fs.existsSync(repoBinary) ? repoBinary : null,
    fs.existsSync(lowerRepoBinary) ? lowerRepoBinary : null,
    'iSMC',
    'ismc',
  ].filter((candidate): candidate is string => Boolean(candidate))

  const errors: string[] = []
  for (const candidate of candidates) {
    const result = await runLocalCommand(candidate, [command, '-o', 'json'], projectRoot)
    if (!result.success || !result.stdout) {
      const message = result.error || result.stdout
      if (message) errors.push(`${path.basename(candidate)} ${command}: ${message}`)
      continue
    }
    try {
      return JSON.parse(result.stdout) as unknown
    } catch {
      errors.push(`${path.basename(candidate)} ${command}: invalid JSON output`)
      continue
    }
  }
  lastISMCError = errors[errors.length - 1] ?? 'iSMC command not found.'
  return null
}

async function getISMCSensors(projectRoot: string): Promise<HestiaSystemMetrics['sensors']> {
  lastISMCError = null
  const all = await runISMC('all', projectRoot) as Record<string, Record<string, ISMCSensorEntry>> | null
  const temperatures = all?.Temperature ?? await runISMC('temp', projectRoot) as Record<string, ISMCSensorEntry> | null
  const fans = all?.Fans ?? await runISMC('fans', projectRoot) as Record<string, ISMCSensorEntry> | null
  const power = all?.Power ?? await runISMC('power', projectRoot) as Record<string, ISMCSensorEntry> | null
  const current = all?.Current ?? null
  const voltage = all?.Voltage ?? null
  const battery = all?.Battery ?? null
  const temperatureReadings = Object.entries(temperatures ?? {})
    .map(([name, entry]) => {
      const valueCelsius = parseISMCValue(entry, '°C')
      return valueCelsius === null ? null : { name, valueCelsius }
    })
    .filter((entry): entry is { name: string; valueCelsius: number } => Boolean(entry))
  const fanReadings = Object.entries(fans ?? {})
    .map(([name, entry]) => {
      const rpm = parseISMCValue(entry, 'rpm')
      return rpm === null ? null : { name, rpm }
    })
    .filter((entry): entry is { name: string; rpm: number } => Boolean(entry))
  const powerReadings = Object.entries(power ?? {})
    .map(([name, entry]) => {
      const watts = parseISMCValue(entry, 'W')
      return watts === null ? null : { name, watts }
    })
    .filter((entry): entry is { name: string; watts: number } => Boolean(entry))
  const currentReadings = Object.entries(current ?? {})
    .map(([name, entry]) => {
      const amps = parseISMCValue(entry, 'A')
      return amps === null ? null : { name, amps }
    })
    .filter((entry): entry is { name: string; amps: number } => Boolean(entry))
  const voltageReadings = Object.entries(voltage ?? {})
    .map(([name, entry]) => {
      const volts = parseISMCValue(entry, 'V')
      return volts === null ? null : { name, volts }
    })
    .filter((entry): entry is { name: string; volts: number } => Boolean(entry))
  const batteryReadings = Object.entries(battery ?? {})
    .map(([name, entry]) => ({ name, value: String(entry.value ?? entry.quantity ?? 'unknown') }))
  const available = temperatureReadings.length > 0 ||
    fanReadings.length > 0 ||
    powerReadings.length > 0 ||
    currentReadings.length > 0 ||
    voltageReadings.length > 0 ||
    batteryReadings.length > 0
  return {
    available,
    detail: available
      ? 'Sensor data loaded from the local iSMC CLI backend.'
      : lastISMCError
        ? `iSMC is installed but unavailable: ${lastISMCError}`
        : 'iSMC was not available as a built local binary or installed CLI. Build arcos/iSMC or install iSMC to enable sensor telemetry.',
    temperatures: temperatureReadings,
    fans: fanReadings,
    power: powerReadings,
    current: currentReadings,
    voltage: voltageReadings,
    battery: batteryReadings,
  }
}

export async function getHestiaSystemMetrics(projectRoot: string): Promise<HestiaSystemMetrics> {
  const cpus = os.cpus()
  const currentCpuSnapshot = cpus.map((cpu) => {
    const total = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
    return { idle: cpu.times.idle, total }
  })
  const perCore = cpus.map((cpu, index) => ({
    index,
    percent: cpuUsagePercent(cpu, index, previousCpuSnapshot, currentCpuSnapshot),
  }))
  previousCpuSnapshot = currentCpuSnapshot
  const totalPercent = perCore.length > 0
    ? perCore.reduce((sum, core) => sum + core.percent, 0) / perCore.length
    : 0
  const totalMemory = os.totalmem()
  const freeMemory = os.freemem()
  const usedMemory = Math.max(0, totalMemory - freeMemory)
  const uptimeSeconds = os.uptime()

  return {
    success: true,
    sampledAt: Date.now(),
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    uptimeSeconds,
    bootTimeIso: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
    cpu: {
      model: cpus[0]?.model ?? 'unknown',
      coreCount: cpus.length,
      loadAverage: os.loadavg(),
      totalPercent,
      cores: perCore,
    },
    memory: {
      totalBytes: totalMemory,
      freeBytes: freeMemory,
      usedBytes: usedMemory,
      usedPercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
    },
    disks: await getDiskMetrics(),
    network: await getNetworkMetrics(),
    topProcesses: await getTopProcesses(),
    sensors: await getISMCSensors(projectRoot),
  }
}
