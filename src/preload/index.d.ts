import type { DocMindApi } from '../shared/ipc'

declare global {
  interface Window {
    docmind: DocMindApi
  }
}

export {}
