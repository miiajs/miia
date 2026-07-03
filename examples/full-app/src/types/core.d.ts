import type { User } from '../users/user.table.js'

declare module '@miiajs/core' {
  interface RequestContext {
    user?: User
    requestId?: string
  }
}
