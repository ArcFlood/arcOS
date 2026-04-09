import { spawn } from 'child_process'
import os from 'os'

export type AsyncCommandResult = {
  success: boolean
  stdout: string
  stderr: string
  error?: string
}

export function runCommandAsync(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<AsyncCommandResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? 5000
    const maxOutputBytes = options.maxOutputBytes ?? 512_000
    let stdout = ''
    let stderr = ''
    let settled = false

    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: process.env.HOME ?? os.homedir(),
      },
    })

    const finish = (result: AsyncCommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        ...result,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      })
    }

    const appendCapped = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current, 'utf8') >= maxOutputBytes) return current
      const next = current + chunk.toString('utf8')
      if (Buffer.byteLength(next, 'utf8') <= maxOutputBytes) return next
      return next.slice(0, maxOutputBytes)
    }

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // Ignore failures while terminating timed-out child process.
      }
      finish({
        success: false,
        stdout,
        stderr,
        error: `Command timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk)
    })
    child.on('error', (error) => {
      finish({ success: false, stdout, stderr, error: error.message })
    })
    child.on('close', (code) => {
      if (code === 0) {
        finish({ success: true, stdout, stderr })
        return
      }
      finish({
        success: false,
        stdout,
        stderr,
        error: stderr.trim() || `Exited with status ${code ?? 'unknown'}`,
      })
    })
  })
}
