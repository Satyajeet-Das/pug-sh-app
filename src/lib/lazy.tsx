import { type ComponentType, lazy } from 'react'

type Module = { default: ComponentType }

const MAX_RETRIES = 2

const isChunkLoadError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  return /dynamically imported module|Loading chunk|Failed to fetch|load failed/i.test(error.message)
}

// Storage availability is guaranteed by the check in main.tsx, so no defensive try-catch is needed here.
const loadWithRetry = async (loader: () => Promise<Module>, storageKey: string): Promise<Module> => {
  try {
    const module = await loader()
    sessionStorage.removeItem(storageKey)
    return module
  } catch (error) {
    if (!isChunkLoadError(error)) throw error

    const retryCount = Number(sessionStorage.getItem(storageKey) || '0')
    console.error(`[lazyWithRetry] Chunk load failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error)

    if (retryCount < MAX_RETRIES) {
      sessionStorage.setItem(storageKey, String(retryCount + 1))
      window.location.reload()
      return new Promise<Module>(() => {})
    }

    sessionStorage.removeItem(storageKey)
    return {
      default: () => (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium mb-1">Failed to load page. Please refresh.</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      ),
    }
  }
}

export const lazyWithRetry = (loader: () => Promise<Module>, name?: string) => {
  const storageKey = name ? `chunk-retry:${name}` : 'chunk-retry'
  let loading: Promise<Module> | undefined
  let loaded: Module | undefined
  const preload = () => {
    if (loading) return loading
    loading = loadWithRetry(loader, storageKey).then(module => (loaded = module))
    // Rejections reach the error boundary through React.lazy; a preload nothing renders stays quiet.
    loading.catch(() => {})
    return loading
  }
  const Lazy = lazy(preload)
  // React.lazy suspends on first render even with its chunk loaded, and React holds a shown fallback 300ms.
  // Once preload() settles, the module renders directly.
  const LazyComponent = (props: object) => (loaded ? <loaded.default {...props} /> : <Lazy {...props} />)
  return Object.assign(LazyComponent, { preload })
}
