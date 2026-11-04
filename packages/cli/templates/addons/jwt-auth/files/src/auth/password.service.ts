import { Injectable } from '@miiajs/core'

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return Bun.password.hash(password)
  }

  verify(password: string, hash: string): Promise<boolean> {
    return Bun.password.verify(password, hash)
  }
}
