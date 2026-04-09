export async function listOllamaModels(): Promise<{ success: boolean; models: string[] }> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return { success: false, models: [] }
    const data = await res.json() as { models?: Array<{ name: string }> }
    const models = (data.models ?? []).map((m) => m.name)
    return { success: true, models }
  } catch {
    return { success: false, models: [] }
  }
}

export async function listOllamaModelDetails(): Promise<{ success: boolean; models: Array<{
  name: string
  sizeBytes: number
  modifiedAt?: string
  family?: string
  parameterSize?: string
  quantizationLevel?: string
}> }> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return { success: false, models: [] }
    const data = await res.json() as {
      models?: Array<{
        name: string
        modified_at?: string
        size?: number
        details?: {
          family?: string
          parameter_size?: string
          quantization_level?: string
        }
      }>
    }
    const models = (data.models ?? []).map((model) => ({
      name: model.name,
      sizeBytes: model.size ?? 0,
      modifiedAt: model.modified_at,
      family: model.details?.family,
      parameterSize: model.details?.parameter_size,
      quantizationLevel: model.details?.quantization_level,
    }))
    return { success: true, models }
  } catch {
    return { success: false, models: [] }
  }
}

export async function deleteOllamaModel(modelName: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch('http://localhost:11434/api/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    const txt = await res.text()
    return { success: false, error: `${res.status}: ${txt}` }
  }
  return { success: true }
}
