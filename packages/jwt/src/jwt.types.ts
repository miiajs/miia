export interface JwtOptions {
  secret?: string
  publicKey?: string | CryptoKey
  privateKey?: string | CryptoKey
  algorithm?: string
  expiresIn?: string | number
  issuer?: string
  audience?: string
}

export interface JwtSignOptions {
  secret?: string
  privateKey?: string | CryptoKey
  algorithm?: string
  expiresIn?: string | number
  subject?: string
  issuer?: string
  audience?: string
  notBefore?: string | number
}

export interface JwtVerifyOptions {
  secret?: string
  publicKey?: string | CryptoKey
  algorithms?: string[]
  issuer?: string
  audience?: string
}

export interface JwtPayload {
  [key: string]: unknown
}
