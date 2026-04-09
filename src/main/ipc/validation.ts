export function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

export function requireString(value: unknown, name: string, maxLength = 10_000): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required`)
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${name} exceeds ${maxLength} characters`)
  }
  return trimmed
}

export function requireStringValue(value: unknown, name: string, maxLength = 10_000): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`)
  }
  if (value.length > maxLength) {
    throw new Error(`${name} exceeds ${maxLength} characters`)
  }
  return value
}

export function optionalString(value: unknown, name: string, maxLength = 10_000): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireString(value, name, maxLength)
}

export function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`)
  }
  return value
}

export function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`)
  }
  return value
}

export function optionalInteger(value: unknown, name: string, fallback: number, min = 0, max = 10_000): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`)
  }
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`)
  }
  return value
}

export function requireStringArray(value: unknown, name: string, maxItems = 200, maxItemLength = 4096): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`)
  }
  if (value.length > maxItems) {
    throw new Error(`${name} exceeds ${maxItems} items`)
  }
  return value.map((item, index) => requireString(item, `${name}[${index}]`, maxItemLength))
}

export function requireStringRecord(value: unknown, name: string, maxKeys = 500, maxValueLength = 4096): Record<string, string> {
  const obj = requireObject(value, name)
  const entries = Object.entries(obj)
  if (entries.length > maxKeys) {
    throw new Error(`${name} exceeds ${maxKeys} entries`)
  }
  return Object.fromEntries(entries.map(([key, entryValue]) => [
    requireString(key, `${name} key`, 200),
    requireString(entryValue, `${name}.${key}`, maxValueLength),
  ]))
}

export function requireHttpUrl(value: unknown, name: string): string {
  const url = requireString(value, name, 2048)
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must be an http(s) URL`)
  }
  return parsed.toString()
}
