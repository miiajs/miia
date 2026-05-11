export interface PaprModuleOptions {
  connection: {
    url: string
    dbName?: string
    retry?: {
      attempts?: number
      delay?: number
    }
  }
}

export type { ModelToken } from './define-model.js'
export type { PaprDbToken } from './tokens.js'
