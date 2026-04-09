import { BrowserWindow } from 'electron'
import path from 'path'

async function waitForVite(url: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (res.ok || res.status === 304) return
    } catch {
      // Vite is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

export function loadRenderer(
  win: BrowserWindow,
  options: {
    isDev: boolean
    distIndexPath: string
    query?: Record<string, string>
    openDevTools?: boolean
  },
): void {
  const { isDev, distIndexPath, query, openDevTools = false } = options
  if (isDev) {
    const search = query ? `?${new URLSearchParams(query).toString()}` : ''
    const devUrl = `http://localhost:5173${search}`
    waitForVite(devUrl).then(() => {
      win.loadURL(devUrl)
      if (openDevTools) {
        win.webContents.openDevTools({ mode: 'detach' })
      }
    })
    return
  }

  win.loadFile(path.resolve(distIndexPath), { query })
}
