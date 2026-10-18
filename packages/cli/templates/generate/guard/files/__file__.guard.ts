import { type CanActivate, Injectable, type RequestContext } from '@miiajs/core'

@Injectable()
export class __Name__Guard implements CanActivate {
  canActivate(_ctx: RequestContext): boolean {
    return true
  }
}
