export async function readJsonResponse<T = any>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function readOptionalJsonResponse<T = any>(response: Response, fallback: NoInfer<T>): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json().catch(() => fallback) as Promise<T>
}
