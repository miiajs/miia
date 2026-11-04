import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto'
import { Injectable } from '@miiajs/core'

// OWASP minimum for scrypt: N=2^17, r=8, p=1 (128 MiB per hash)
const COST = { N: 2 ** 17, r: 8, p: 1 }
const KEY_LENGTH = 64

function derive(password: string, salt: Buffer, keylen: number, cost: typeof COST): Promise<Buffer> {
  const options: ScryptOptions = { ...cost, maxmem: 256 * cost.N * cost.r }
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

@Injectable()
export class PasswordService {
  // Stored as scrypt$<N>$<r>$<p>$<salt hex>$<hash hex>, so the cost can grow without breaking old hashes
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16)
    const hash = await derive(password, salt, KEY_LENGTH, COST)
    return ['scrypt', COST.N, COST.r, COST.p, salt.toString('hex'), hash.toString('hex')].join('$')
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [algorithm, N, r, p, salt, hash] = stored.split('$')
    if (algorithm !== 'scrypt' || !salt || !hash) return false
    const expected = Buffer.from(hash, 'hex')
    const actual = await derive(password, Buffer.from(salt, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    })
    return timingSafeEqual(actual, expected)
  }
}
