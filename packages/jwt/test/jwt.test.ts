import { describe, expect, it } from 'bun:test'
import { Container, runInContainerContext } from '@miiajs/core'
import { SignJWT } from 'jose'
import { JWT_OPTIONS } from '../src/constants.js'
import { JwtService } from '../src/jwt.service.js'
import type { JwtOptions } from '../src/jwt.types.js'

function makeService(options: JwtOptions): JwtService {
  const container = new Container()
  container.register(JWT_OPTIONS, () => options, 'singleton')
  container.register(JwtService, () => new JwtService(), 'singleton')
  return container.resolve(JwtService)
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

  it('new JwtService() inside runInContainerContext resolves JWT_OPTIONS from container', async () => {
    const container = new Container()
    container.register(JWT_OPTIONS, () => ({ secret, algorithm: 'HS256' }) satisfies JwtOptions, 'singleton')

    const payload = await runInContainerContext(container, async () => {
      const svc = new JwtService()
      const token = await svc.sign({ sub: 'dave' })
      return svc.verify<{ sub: string }>(token)
    })

    expect(payload.sub).toBe('dave')
  })
})
