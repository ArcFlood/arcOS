export function configureBundledAppPath(): void {
  if (process.platform !== 'darwin') return

  const extraPaths = [
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
  const prepend = extraPaths.filter((p) => !existing.has(p))
  process.env.PATH = [...prepend, current].join(':')
}
