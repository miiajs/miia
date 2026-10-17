import { describe, expect, it } from 'bun:test'
import { Miia } from '@miiajs/core'
import { SignJWT, decodeJwt, decodeProtectedHeader, exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { JwtModule } from '../src/jwt.module.js'
import { JwtService } from '../src/jwt.service.js'
import type { JwtOptions } from '../src/jwt.types.js'

function makeService(options: JwtOptions): JwtService {
  return new Miia({ logger: false }).register(JwtModule.configure(options)).get(JwtService)
}

const secret = 'a-very-long-shared-secret-for-hs256-tests-0123456789'

describe('JwtService.verify - algorithm constraint', () => {
  it('rejects a token signed with HS384 when module is configured for HS256', async () => {
    const svc = makeService({ secret, algorithm: 'HS256' })

    const hs384Token = await new SignJWT({ sub: 'alice' })
      .setProtectedHeader({ alg: 'HS384' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    await expect(svc.verify(hs384Token)).rejects.toThrow()
  })

  it('accepts a token signed with the configured algorithm', async () => {
    const svc = makeService({ secret, algorithm: 'HS256' })

    const token = await svc.sign({ sub: 'alice' })
    const payload = await svc.verify<{ sub: string }>(token)

    expect(payload.sub).toBe('alice')
  })

  it('honors explicit options.algorithms whitelist when passed', async () => {
    const svc = makeService({ secret, algorithm: 'HS256' })

    const hs384Token = await new SignJWT({ sub: 'bob' })
      .setProtectedHeader({ alg: 'HS384' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    const payload = await svc.verify<{ sub: string }>(hs384Token, { algorithms: ['HS384'] })
    expect(payload.sub).toBe('bob')
  })

  it('defaults to HS256 for symmetric keys when no algorithm configured', async () => {
    const svc = makeService({ secret })

    const hs512Token = await new SignJWT({ sub: 'eve' })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    // Default alg is HS256 → HS512 token must be rejected
    await expect(svc.verify(hs512Token)).rejects.toThrow()
  })
})

describe('JwtService - standalone construction', () => {
  it('new JwtService({ secret }) works without an active container', async () => {
    // No container context - inject() would throw if called, but `??` short-circuits.
    const svc = new JwtService({ secret, algorithm: 'HS256' })
    const token = await svc.sign({ sub: 'carol' })
    const payload = await svc.verify<{ sub: string }>(token)
    expect(payload.sub).toBe('carol')
  })

  it('JwtService reads the options JwtModule.configure() registered', async () => {
    const svc = makeService({ secret, algorithm: 'HS256' })
    const token = await svc.sign({ sub: 'dave' })
    expect(decodeProtectedHeader(token).alg).toBe('HS256')

    const payload = await svc.verify<{ sub: string }>(token)
    expect(payload.sub).toBe('dave')
  })
})

describe('JwtModule.configure - exports and global', () => {
  it('exports JwtService and leaves global unset by default', () => {
    const configured = JwtModule.configure({ secret })
    expect(configured.exports).toEqual([JwtService])
    expect(configured.global).toBeUndefined()
  })

  it('passes { global: true } through', () => {
    expect(JwtModule.configure({ secret }, { global: true }).global).toBe(true)
  })
})

describe('JwtService - without JwtModule.configure()', () => {
  it('names JwtModule.configure() when JwtService is not provided', () => {
    expect(() => new Miia({ logger: false }).get(JwtService)).toThrow('JwtService is provided by JwtModule.configure()')
  })

  it('names JwtModule.configure() when JwtService is provided without its options', () => {
    expect(() => new Miia({ logger: false }).provide(JwtService).get(JwtService)).toThrow(
      'JwtOptions is provided by JwtModule.configure()',
    )
  })
})

describe('JwtService.sign - default algorithm', () => {
  it('defaults to RS256 with a PEM private key', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
    const svc = new JwtService({ privateKey: await exportPKCS8(privateKey), publicKey: await exportSPKI(publicKey) })

    const token = await svc.sign({ sub: 'frank' })
    expect(decodeProtectedHeader(token).alg).toBe('RS256')

    const payload = await svc.verify<{ sub: string }>(token)
    expect(payload.sub).toBe('frank')
  })

  it('defaults to RS256 with a CryptoKey private key', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
    const svc = new JwtService({ privateKey, publicKey })

    const token = await svc.sign({ sub: 'grace' })
    expect(decodeProtectedHeader(token).alg).toBe('RS256')

    const payload = await svc.verify<{ sub: string }>(token)
    expect(payload.sub).toBe('grace')
  })

  it('defaults to HS256 with a secret', async () => {
    const svc = new JwtService({ secret })

    const token = await svc.sign({ sub: 'heidi' })
    expect(decodeProtectedHeader(token).alg).toBe('HS256')
  })
})

describe('JwtService.sign - numeric durations', () => {
  it('reads a numeric expiresIn as seconds from now', async () => {
    const svc = new JwtService({ secret })

    const token = await svc.sign({ sub: 'ivan' }, { expiresIn: 3600 })
    const { iat, exp } = decodeJwt(token)
    expect(exp! - iat!).toBe(3600)
    expect((await svc.verify<{ sub: string }>(token)).sub).toBe('ivan')
  })

  it('reads a numeric module expiresIn as seconds from now', async () => {
    const svc = new JwtService({ secret, expiresIn: 60 })

    const { iat, exp } = decodeJwt(await svc.sign({ sub: 'judy' }))
    expect(exp! - iat!).toBe(60)
  })

  it('reads a numeric notBefore as seconds from now', async () => {
    const svc = new JwtService({ secret })

    const { iat, nbf } = decodeJwt(await svc.sign({ sub: 'ken' }, { notBefore: 30 }))
    expect(nbf! - iat!).toBe(30)
  })

  it('keeps string durations relative', async () => {
    const svc = new JwtService({ secret })

    const { iat, exp, nbf } = decodeJwt(await svc.sign({ sub: 'lena' }, { expiresIn: '2h', notBefore: '10s' }))
    // jose counts a string from its own clock reading, which may have crossed a second boundary since iat
    expect(exp! - iat!).toBeOneOf([7200, 7201])
    expect(nbf! - iat!).toBeOneOf([10, 11])
  })
})

describe('JwtService - per-call keys', () => {
  it('signs and verifies with a per-call key pair over the module secret', async () => {
    const svc = makeService({ secret, algorithm: 'HS384' })
    const { privateKey, publicKey } = await generateKeyPair('RS256')

    const token = await svc.sign({ sub: 'mia' }, { privateKey })
    expect(decodeProtectedHeader(token).alg).toBe('RS256')
    expect((await svc.verify<{ sub: string }>(token, { publicKey })).sub).toBe('mia')
    await expect(svc.verify(token)).rejects.toThrow()
  })

  it('uses a per-call PEM key with the algorithm of the call', async () => {
    const svc = makeService({ secret })
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })

    const token = await svc.sign({ sub: 'nina' }, { privateKey: await exportPKCS8(privateKey), algorithm: 'ES256' })
    expect(decodeProtectedHeader(token).alg).toBe('ES256')
    const payload = await svc.verify<{ sub: string }>(token, {
      publicKey: await exportSPKI(publicKey),
      algorithms: ['ES256'],
    })
    expect(payload.sub).toBe('nina')
  })

  it('uses a per-call secret over the module key pair', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const svc = makeService({ privateKey, publicKey })
    const other = 'another-shared-secret-for-hs256-tests-0123456789'

    const token = await svc.sign({ sub: 'olga' }, { secret: other })
    expect(decodeProtectedHeader(token).alg).toBe('HS256')
    expect((await svc.verify<{ sub: string }>(token, { secret: other })).sub).toBe('olga')
    await expect(svc.verify(token)).rejects.toThrow()
  })

  it('applies the module algorithm to a per-call key of the same kind', async () => {
    const ec = await generateKeyPair('ES256', { extractable: true })
    const svc = makeService({ privateKey: (await generateKeyPair('ES256')).privateKey, algorithm: 'ES256' })

    const token = await svc.sign({ sub: 'quinn' }, { privateKey: await exportPKCS8(ec.privateKey) })
    expect(decodeProtectedHeader(token).alg).toBe('ES256')
    expect((await svc.verify<{ sub: string }>(token, { publicKey: await exportSPKI(ec.publicKey) })).sub).toBe('quinn')

    const hs = makeService({ secret, algorithm: 'HS512' })
    const other = 'rotated-shared-secret-for-hs512-tests-0123456789'
    const rotated = await hs.sign({ sub: 'rita' }, { secret: other })
    expect(decodeProtectedHeader(rotated).alg).toBe('HS512')
    expect((await hs.verify<{ sub: string }>(rotated, { secret: other })).sub).toBe('rita')
  })

  it('keeps the module algorithm for the module key', async () => {
    const svc = makeService({ secret, algorithm: 'HS384' })

    const token = await svc.sign({ sub: 'pia' })
    expect(decodeProtectedHeader(token).alg).toBe('HS384')
    expect((await svc.verify<{ sub: string }>(token)).sub).toBe('pia')
  })
})
