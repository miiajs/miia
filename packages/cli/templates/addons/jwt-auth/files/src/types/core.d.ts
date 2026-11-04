import type { User } from '../users/users.types.js'

declare module '@miiajs/core' {
  interface RequestContext {
    user?: User
  }
}
