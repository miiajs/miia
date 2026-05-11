import type { User } from '../users/users.schema.js'

declare module '@miiajs/core' {
  interface RequestContext {
    user?: User
    requestId?: string
  }
}
