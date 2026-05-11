import type { ZodLike } from '@miiajs/core'

// ─── Decorator option types ─────────────────────────────────────

export interface ApiOperationOptions {
  summary?: string
  description?: string
  operationId?: string
  deprecated?: boolean
}

export interface ApiResponseOptions {
  description?: string
  schema?: ZodLike | JsonSchema
}

export interface ApiParamOptions {
  description?: string
  required?: boolean
  schema?: ZodLike | JsonSchema
}

export interface ApiQueryOptions {
  description?: string
  required?: boolean
  schema?: ZodLike | JsonSchema
}

export interface ApiHeaderOptions {
  description?: string
  required?: boolean
}

export interface ApiBodyOptions {
  /** OpenAPI media type. Defaults to `'application/json'`. */
  contentType?: string
  /** Whether the request body is required. Defaults to `true`. */
  required?: boolean
  /** Optional human-readable description shown in Swagger UI. */
  description?: string
}

// ─── Stored metadata shapes ─────────────────────────────────────

export interface ApiResponseMeta {
  status: number
  description?: string
  schema?: ZodLike | JsonSchema
}

export interface ApiParamMeta {
  name: string
  description?: string
  required?: boolean
  schema?: ZodLike | JsonSchema
}

export interface ApiQueryMeta {
  name: string
  description?: string
  required?: boolean
  schema?: ZodLike | JsonSchema
}

export interface ApiSecurityMeta {
  name: string
  scopes: string[]
}

export interface ApiHeaderMeta {
  name: string
  description?: string
  required?: boolean
}

// ─── JSON Schema (subset) ───────────────────────────────────────

export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: any[]
  const?: any
  description?: string
  format?: string
  default?: any
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  nullable?: boolean
  [key: string]: any
}

// ─── Swagger setup options ──────────────────────────────────────

export interface SwaggerSetupOptions {
  title: string
  version: string
  description?: string
  servers?: Array<{ url: string; description?: string }>
  securitySchemes?: Record<string, any>
  globalSecurity?: Array<Record<string, string[]>>
  path?: string
  uiPath?: string
  ui?: boolean
  swaggerOptions?: Record<string, any>
}
