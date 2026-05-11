import { Injectable, inject } from '@miiajs/core'
import { SignJWT, jwtVerify, importSPKI, importPKCS8 } from 'jose'
import { JWT_OPTIONS } from './constants.js'
import type { JwtOptions, JwtPayload, JwtSignOptions, JwtVerifyOptions } from './jwt.types.js'

type SignKey = CryptoKey | Uint8Array

@Injectable()
export class JwtService {
  private options!: JwtOptions

  constructor(options?: JwtOptions) {
    this.options = options ?? inject<JwtOptions>(JWT_OPTIONS)
  }

  async sign(payload: JwtPayload, options?: JwtSignOptions): Promise<string> {
    const alg = options?.algorithm ?? this.options.algorithm ?? 'HS256'
    const exp = options?.expiresIn ?? this.options.expiresIn ?? '1h'

    const key = await this.resolveSignKey(options)

    let builder = new SignJWT(payload).setProtectedHeader({ alg }).setIssuedAt().setExpirationTime(exp)

    const issuer = options?.issuer ?? this.options.issuer
    if (issuer) builder = builder.setIssuer(issuer)

    const audience = options?.audience ?? this.options.audience
    if (audience) builder = builder.setAudience(audience)

    if (options?.subject) builder = builder.setSubject(options.subject)
    if (options?.notBefore) builder = builder.setNotBefore(options.notBefore)

    return builder.sign(key)
  }

  async verify<T extends JwtPayload = JwtPayload>(token: string, options?: JwtVerifyOptions): Promise<T> {
    const key = await this.resolveVerifyKey(options)

    const defaultAlg = this.options.algorithm ?? (key instanceof Uint8Array ? 'HS256' : 'RS256')
    const verifyOptions: Parameters<typeof jwtVerify>[2] = {
      algorithms: options?.algorithms ?? [defaultAlg],
    }

    const issuer = options?.issuer ?? this.options.issuer
    if (issuer) verifyOptions.issuer = issuer

    const audience = options?.audience ?? this.options.audience
    if (audience) verifyOptions.audience = audience

    const { payload } = await jwtVerify(token, key, verifyOptions)
    return payload as T
  }

  private async resolveSignKey(options?: JwtSignOptions): Promise<SignKey> {
    const secret = options?.secret ?? this.options.secret
    if (secret) return new TextEncoder().encode(secret)

    const privateKey = options?.privateKey ?? this.options.privateKey
    if (privateKey) {
      if (typeof privateKey === 'string') {
        const alg = options?.algorithm ?? this.options.algorithm ?? 'RS256'
        return importPKCS8(privateKey, alg)
      }
      return privateKey
    }

    throw new Error('JwtService: no secret or privateKey configured')
  }

  private async resolveVerifyKey(options?: JwtVerifyOptions): Promise<SignKey> {
    const secret = options?.secret ?? this.options.secret
    if (secret) return new TextEncoder().encode(secret)

    const publicKey = options?.publicKey ?? this.options.publicKey
    if (publicKey) {
      if (typeof publicKey === 'string') {
        const alg = options?.algorithms?.[0] ?? this.options.algorithm ?? 'RS256'
        return importSPKI(publicKey, alg)
      }
      return publicKey
    }

    throw new Error('JwtService: no secret or publicKey configured')
  }
}
