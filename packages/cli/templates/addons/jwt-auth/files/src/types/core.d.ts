import type { User } from '../users/users.service.js'

declare module '@miiajs/core' {
  interface RequestContext {
    user?: User
  }
}
