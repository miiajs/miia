import { Injectable, inject } from '@miiajs/core'
import { SignJWT, jwtVerify, importSPKI, importPKCS8 } from 'jose'
import { JWT_OPTIONS } from './constants.js'
import type { JwtOptions, JwtPayload, JwtSignOptions, JwtVerifyOptions } from './jwt.types.js'

type SignKey = CryptoKey | Uint8Array

@Injectable({ hint: 'JwtModule.configure()' })
export class JwtService {
  private options!: JwtOptions

  constructor(options?: JwtOptions) {
    this.options = options ?? inject(JWT_OPTIONS)
  }

  async sign(payload: JwtPayload, options?: JwtSignOptions): Promise<string> {
    const { key, alg } = await this.resolveSignKey(options)
    const exp = options?.expiresIn ?? this.options.expiresIn ?? '1h'
    // jose reads a number as an absolute timestamp; ours are seconds from now, counted from the same iat
    const now = Math.floor(Date.now() / 1000)

    let builder = new SignJWT(payload)
      .setProtectedHeader({ alg })
      .setIssuedAt(now)
      .setExpirationTime(typeof exp === 'number' ? now + exp : exp)

    const issuer = options?.issuer ?? this.options.issuer
    if (issuer) builder = builder.setIssuer(issuer)

    const audience = options?.audience ?? this.options.audience
    if (audience) builder = builder.setAudience(audience)

    if (options?.subject) builder = builder.setSubject(options.subject)
    const nbf = options?.notBefore
    if (typeof nbf === 'number') builder = builder.setNotBefore(now + nbf)
    else if (nbf) builder = builder.setNotBefore(nbf)

    return builder.sign(key)
  }

  async verify<T extends JwtPayload = JwtPayload>(token: string, options?: JwtVerifyOptions): Promise<T> {
    const { key, alg } = await this.resolveVerifyKey(options)
    const verifyOptions: Parameters<typeof jwtVerify>[2] = {
      algorithms: options?.algorithms ?? [alg],
    }

    const issuer = options?.issuer ?? this.options.issuer
    if (issuer) verifyOptions.issuer = issuer

    const audience = options?.audience ?? this.options.audience
    if (audience) verifyOptions.audience = audience

    const { payload } = await jwtVerify(token, key, verifyOptions)
    return payload as T
  }

  // A key passed to the call wins over the module's. Its algorithm: the call's, else the module's when it fits the
  // kind of key (HS* for a secret, the rest for a key pair), else the default for the kind.
  private async resolveSignKey(options?: JwtSignOptions): Promise<{ key: SignKey; alg: string }> {
    const own = Boolean(options?.secret || options?.privateKey)
    const source = own ? options! : this.options

    if (source.secret) {
      return {
        key: new TextEncoder().encode(source.secret),
        alg: options?.algorithm ?? this.moduleAlgorithm(own, true) ?? 'HS256',
      }
    }

    const privateKey = source.privateKey
    if (privateKey) {
      const alg = options?.algorithm ?? this.moduleAlgorithm(own, false) ?? 'RS256'
      return { key: typeof privateKey === 'string' ? await importPKCS8(privateKey, alg) : privateKey, alg }
    }

    throw new Error('JwtService: no secret or privateKey configured')
  }

  private async resolveVerifyKey(options?: JwtVerifyOptions): Promise<{ key: SignKey; alg: string }> {
    const own = Boolean(options?.secret || options?.publicKey)
    const source = own ? options! : this.options

    if (source.secret) {
      return {
        key: new TextEncoder().encode(source.secret),
        alg: options?.algorithms?.[0] ?? this.moduleAlgorithm(own, true) ?? 'HS256',
      }
    }

    const publicKey = source.publicKey
    if (publicKey) {
      const alg = options?.algorithms?.[0] ?? this.moduleAlgorithm(own, false) ?? 'RS256'
      return { key: typeof publicKey === 'string' ? await importSPKI(publicKey, alg) : publicKey, alg }
    }

    throw new Error('JwtService: no secret or publicKey configured')
  }

  private moduleAlgorithm(perCallKey: boolean, symmetric: boolean): string | undefined {
    const alg = this.options.algorithm
    if (alg === undefined || !perCallKey) return alg
    return alg.startsWith('HS') === symmetric ? alg : undefined
  }
}
