import type { Constructor, RouteDefinition, Guard, ZodLike, GuardResponseDeclaration } from '@miiajs/core'
import {
  getMeta,
  ROUTES,
  STATUSES,
  CLASS_GUARDS,
  METHOD_GUARDS,
  BODY_SCHEMAS,
  QUERY_SCHEMAS,
  PARAMS_SCHEMAS,
  SKIP_GUARDS,
  GUARD_FACTORY,
  GUARD_RESPONSES,
} from '@miiajs/core'

export interface DiscoveredController {
  controller: Constructor
  prefix: string
}
import {
  API_TAG,
  API_OPERATIONS,
  API_RESPONSES,
  API_PARAMS,
  API_QUERIES,
  API_SECURITY,
  API_HEADERS,
  API_EXCLUDE,
  API_BODY_OPTIONS,
} from '../constants.js'
import type {
  SwaggerSetupOptions,
  ApiOperationOptions,
  ApiResponseMeta,
  ApiParamMeta,
  ApiQueryMeta,
  ApiSecurityMeta,
  ApiHeaderMeta,
  ApiBodyOptions,
  JsonSchema,
} from '../types.js'
import { convertSchema } from './schema-converter.js'
import { toOpenApiPath, extractPathParams } from './path-converter.js'

type Io = 'input' | 'output'

export class SpecBuilder {
  /** Component name -> serialized body, for dedup. Reset per `build()`. */
  private componentNames = new Map<string, string>()

  build(
    controllers: DiscoveredController[],
    options: SwaggerSetupOptions,
    globalGuards: readonly unknown[] = [],
  ): Record<string, any> {
    this.componentNames = new Map()

    const doc: Record<string, any> = {
      openapi: '3.1.0',
      info: {
        title: options.title,
        version: options.version,
        ...(options.description && { description: options.description }),
      },
      paths: {},
      tags: [],
    }

    if (options.servers?.length) {
      doc.servers = options.servers
    }

    if (options.securitySchemes && Object.keys(options.securitySchemes).length) {
      doc.components = { securitySchemes: options.securitySchemes }
    }

    if (options.globalSecurity?.length) {
      doc.security = options.globalSecurity
    }

    const tagSet = new Set<string>()

    for (const { controller, prefix } of controllers) {
      this.processController(doc, controller, prefix, tagSet, globalGuards)
    }

    doc.tags = [...tagSet].map((name) => ({ name }))

    return doc
  }

  private processController(
    doc: Record<string, any>,
    controller: Constructor,
    prefix: string,
    tagSet: Set<string>,
    globalGuards: readonly unknown[],
  ): void {
    // Check exclude
    if (this.isExcluded(controller, '*')) return

    // Tags
    const tags = getMeta<string[]>(controller, API_TAG) ?? [controller.name.replace(/Controller$/, '')]
    for (const tag of tags) tagSet.add(tag)

    // Class-level metadata
    const classGuards = getMeta<Guard[]>(controller, CLASS_GUARDS) ?? []
    const classSecurity = this.getClassSecurity(controller)
    const classHeaders = this.getClassHeaders(controller)

    // Routes
    const routes = getMeta<RouteDefinition[]>(controller, ROUTES) ?? []
    const statusMap = getMeta<Map<string, number>>(controller, STATUSES)
    const bodySchemaMap = getMeta<Map<string, ZodLike | JsonSchema>>(controller, BODY_SCHEMAS)
    const bodyOptionsMap = getMeta<Map<string, ApiBodyOptions>>(controller, API_BODY_OPTIONS)
    const querySchemaMap = getMeta<Map<string, ZodLike>>(controller, QUERY_SCHEMAS)
    const paramsSchemaMap = getMeta<Map<string, ZodLike>>(controller, PARAMS_SCHEMAS)
    const operationMap = getMeta<Map<string, ApiOperationOptions>>(controller, API_OPERATIONS)
    const responseMap = getMeta<Map<string, ApiResponseMeta[]>>(controller, API_RESPONSES)
    const paramMap = getMeta<Map<string, ApiParamMeta[]>>(controller, API_PARAMS)
    const queryMap = getMeta<Map<string, ApiQueryMeta[]>>(controller, API_QUERIES)
    const methodGuardMap = getMeta<Map<string, Guard[]>>(controller, METHOD_GUARDS)
    const methodHeaderMap = getMeta<Map<string, ApiHeaderMeta[]>>(controller, API_HEADERS)
    const methodSecurityMap = this.getMethodSecurityMap(controller)

    for (const route of routes) {
      if (this.isExcluded(controller, route.handlerName)) continue

      const fullPath = toOpenApiPath(prefix ? `${prefix}/${route.path}` : route.path)
      const method = route.method.toLowerCase()

      const operation: Record<string, any> = { tags }
      const namePrefix = `${controller.name}_${route.handlerName}`

      // Operation metadata
      const opMeta = operationMap?.get(route.handlerName)
      if (opMeta?.summary) operation.summary = opMeta.summary
      if (opMeta?.description) operation.description = opMeta.description
      if (opMeta?.operationId) operation.operationId = opMeta.operationId
      if (opMeta?.deprecated) operation.deprecated = true

      // Parameters
      const parameters = this.buildParameters(
        route,
        prefix,
        paramMap?.get(route.handlerName),
        queryMap?.get(route.handlerName),
        paramsSchemaMap?.get(route.handlerName),
        querySchemaMap?.get(route.handlerName),
        classHeaders,
        methodHeaderMap?.get(route.handlerName),
        doc,
        namePrefix,
      )
      if (parameters.length) operation.parameters = parameters

      // Request body
      const bodySchema = bodySchemaMap?.get(route.handlerName)
      if (bodySchema) {
        const bodyOpts = bodyOptionsMap?.get(route.handlerName)
        const contentType = bodyOpts?.contentType ?? 'application/json'
        operation.requestBody = {
          required: bodyOpts?.required ?? true,
          ...(bodyOpts?.description && { description: bodyOpts.description }),
          content: {
            [contentType]: {
              schema: this.liftRefs(
                convertSchema(bodySchema, { io: 'input' }),
                doc,
                schemaId(bodySchema) ?? `${namePrefix}_Body`,
                'input',
              ),
            },
          },
        }
      }

      // Responses
      const customStatus = statusMap?.get(route.handlerName)
      const explicitResponses = responseMap?.get(route.handlerName) ?? []
      const skipSet = getSkipSet(controller, route.handlerName)
      const activeGuards = filterGuards(
        [...globalGuards, ...classGuards, ...(methodGuardMap?.get(route.handlerName) ?? [])],
        skipSet,
      )
      const hasValidation =
        !!bodySchema || !!querySchemaMap?.get(route.handlerName) || !!paramsSchemaMap?.get(route.handlerName)

      operation.responses = this.buildResponses(
        customStatus ?? (method === 'post' ? 201 : 200),
        explicitResponses,
        collectGuardResponses(activeGuards),
        hasValidation,
        doc,
        namePrefix,
      )

      // Security
      const security = this.buildSecurity(classSecurity, methodSecurityMap?.get(route.handlerName))
      if (security.length) operation.security = security

      // Add to paths
      if (!doc.paths[fullPath]) doc.paths[fullPath] = {}
      doc.paths[fullPath][method] = operation
    }
  }

  private buildParameters(
    route: RouteDefinition,
    prefix: string,
    explicitParams: ApiParamMeta[] | undefined,
    explicitQueries: ApiQueryMeta[] | undefined,
    paramsSchema: ZodLike | undefined,
    querySchema: ZodLike | undefined,
    classHeaders: ApiHeaderMeta[],
    methodHeaders: ApiHeaderMeta[] | undefined,
    doc: Record<string, any>,
    namePrefix: string,
  ): any[] {
    const parameters: any[] = []
    const fullPath = prefix ? `${prefix}/${route.path}` : route.path

    // Path params: explicit > auto-inferred from schema > auto-inferred from path
    const pathParamNames = extractPathParams(fullPath)
    const explicitParamNames = new Set((explicitParams ?? []).map((p) => p.name))

    // Add explicit params first
    for (const param of explicitParams ?? []) {
      parameters.push({
        name: param.name,
        in: 'path',
        required: true,
        ...(param.description && { description: param.description }),
        schema: param.schema
          ? this.liftRefs(
              convertSchema(param.schema, { io: 'input' }),
              doc,
              schemaId(param.schema) ?? `${namePrefix}_Param_${param.name}`,
              'input',
            )
          : { type: 'string' },
      })
    }

    // Auto-infer from schema for non-explicit params
    // keepRootInline: the root's `properties` are read below - a root `$ref` would hide them.
    const paramsJsonSchema = paramsSchema
      ? this.liftRefs(
          convertSchema(paramsSchema, { io: 'input' }),
          doc,
          schemaId(paramsSchema) ?? `${namePrefix}_Params`,
          'input',
          { keepRootInline: true },
        )
      : null
    for (const name of pathParamNames) {
      if (explicitParamNames.has(name)) continue
      const propSchema = paramsJsonSchema?.properties?.[name]
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: propSchema ?? { type: 'string' },
      })
    }

    // Query params: explicit > auto-inferred from schema
    const explicitQueryNames = new Set((explicitQueries ?? []).map((q) => q.name))

    for (const query of explicitQueries ?? []) {
      parameters.push({
        name: query.name,
        in: 'query',
        ...(query.required && { required: true }),
        ...(query.description && { description: query.description }),
        schema: query.schema
          ? this.liftRefs(
              convertSchema(query.schema, { io: 'input' }),
              doc,
              schemaId(query.schema) ?? `${namePrefix}_Query_${query.name}`,
              'input',
            )
          : { type: 'string' },
      })
    }

    // Auto-infer query from schema (keepRootInline for the same reason as path params)
    if (querySchema) {
      const queryJsonSchema = this.liftRefs(
        convertSchema(querySchema, { io: 'input' }),
        doc,
        schemaId(querySchema) ?? `${namePrefix}_Query`,
        'input',
        { keepRootInline: true },
      )
      const requiredFields = new Set(queryJsonSchema.required ?? [])
      for (const [name, propSchema] of Object.entries(queryJsonSchema.properties ?? {})) {
        if (explicitQueryNames.has(name)) continue
        parameters.push({
          name,
          in: 'query',
          ...(requiredFields.has(name) && { required: true }),
          ...(propSchema.description && { description: propSchema.description }),
          schema: propSchema,
        })
      }
    }

    // Headers: class-level + method-level
    for (const header of [...classHeaders, ...(methodHeaders ?? [])]) {
      parameters.push({
        name: header.name,
        in: 'header',
        ...(header.required && { required: true }),
        ...(header.description && { description: header.description }),
        schema: { type: 'string' },
      })
    }

    return parameters
  }

  private buildResponses(
    defaultStatus: number,
    explicit: ApiResponseMeta[],
    guardStatuses: Map<number, string | undefined>,
    hasValidation: boolean,
    doc: Record<string, any>,
    namePrefix: string,
  ): Record<string, any> {
    const responses: Record<string, any> = {}
    const explicitStatuses = new Set(explicit.map((r) => r.status))

    // Default success response
    if (!explicit.some((r) => r.status >= 200 && r.status < 400)) {
      const hasBody = defaultStatus >= 200 && defaultStatus < 300 && defaultStatus !== 204 && defaultStatus !== 205
      responses[String(defaultStatus)] = {
        description: statusText(defaultStatus),
        ...(hasBody && { content: { 'application/json': { schema: {} } } }),
      }
    }

    // Explicit responses
    for (const res of explicit) {
      const entry: Record<string, any> = {
        description: res.description ?? statusText(res.status),
      }
      if (res.schema) {
        entry.content = {
          'application/json': {
            schema: this.liftRefs(
              convertSchema(res.schema, { io: 'output' }),
              doc,
              schemaId(res.schema) ?? `${namePrefix}_Response_${res.status}`,
              'output',
            ),
          },
        }
      }
      responses[String(res.status)] = entry
    }

    // Guard-declared rejection codes
    for (const [status, description] of guardStatuses) {
      if (explicitStatuses.has(status)) continue
      responses[String(status)] = { description: description ?? statusText(status) }
    }

    // Auto-add 422 for validation
    if (hasValidation && !explicitStatuses.has(422)) {
      responses['422'] = { description: 'Unprocessable Entity' }
    }

    return responses
  }

  /**
   * Moves `$defs` into `components.schemas` and rewrites the pointers - inlined `#/$defs/...`
   * and `#` would dangle in an OpenAPI document. `keepRootInline` leaves a self-referential
   * root in place for callers that enumerate its `.properties`.
   */
  private liftRefs(
    schema: JsonSchema,
    doc: Record<string, any>,
    nameHint: string,
    io: Io,
    opts?: { keepRootInline?: boolean },
  ): JsonSchema {
    if (!schema || typeof schema !== 'object') return schema

    const defs = schema.$defs as Record<string, JsonSchema> | undefined
    const rootRef = hasRootRef(schema)
    if (!defs && !rootRef) return schema

    // convertSchema hands back the caller's own object for raw JSON Schema - never mutate it
    const work: JsonSchema = clone(schema)
    doc.components ??= {}
    doc.components.schemas ??= {}
    delete work.$defs

    const refMap = new Map<string, string>()
    const finalNames: Record<string, string> = {}
    for (const [name, body] of Object.entries(defs ?? {})) {
      finalNames[name] = this.allocateComponent(doc, sanitizeName(name), body, io)
      refMap.set(`#/$defs/${name}`, `#/components/schemas/${finalNames[name]}`)
    }

    let rootName: string | undefined
    if (rootRef) {
      rootName = this.allocateComponent(doc, sanitizeName(nameHint), work, io)
      refMap.set('#', `#/components/schemas/${rootName}`)
    }

    rewriteRefs(work, refMap)
    for (const [name, finalName] of Object.entries(finalNames)) {
      const body = clone(defs![name])
      rewriteRefs(body, refMap)
      doc.components.schemas[finalName] = body
    }
    if (rootName) {
      doc.components.schemas[rootName] = clone(work)
      if (!opts?.keepRootInline) return { $ref: `#/components/schemas/${rootName}` }
    }

    return work
  }

  private allocateComponent(doc: Record<string, any>, base: string, body: JsonSchema, io: Io): string {
    const key = JSON.stringify(body)
    const schemas = doc.components.schemas
    for (let i = 0; ; i++) {
      const name = i === 0 ? base : i === 1 ? `${base}_${io === 'output' ? 'Output' : 'Input'}` : `${base}_${i}`
      if (!(name in schemas)) {
        this.componentNames.set(name, key)
        // Reserved now; the body lands after the refs are rewritten
        schemas[name] = {}
        return name
      }
      if (this.componentNames.get(name) === key) return name
    }
  }

  private buildSecurity(
    classSecurity: ApiSecurityMeta[],
    methodSecurity: ApiSecurityMeta[] | undefined,
  ): Array<Record<string, string[]>> {
    const merged = methodSecurity ?? classSecurity
    return merged.map((s) => ({ [s.name]: s.scopes }))
  }

  private isExcluded(controller: Constructor, handler: string): boolean {
    const set = getMeta<Set<string>>(controller, API_EXCLUDE)
    if (!set) return false
    return set.has('*') || set.has(handler)
  }

  private getClassSecurity(controller: Constructor): ApiSecurityMeta[] {
    return getMeta<Map<string, ApiSecurityMeta[]>>(controller, API_SECURITY)?.get('*') ?? []
  }

  private getClassHeaders(controller: Constructor): ApiHeaderMeta[] {
    return getMeta<Map<string, ApiHeaderMeta[]>>(controller, API_HEADERS)?.get('*') ?? []
  }

  private getMethodSecurityMap(controller: Constructor): Map<string, ApiSecurityMeta[]> | undefined {
    return getMeta<Map<string, ApiSecurityMeta[]>>(controller, API_SECURITY)
  }
}

function statusText(code: number): string {
  const texts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    302: 'Found',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    413: 'Payload Too Large',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
  }
  return texts[code] ?? 'Response'
}

// ─── Guards ─────────────────────────────────────────────────────

// Kept in sync by hand with router-explorer.ts (getSkipSet/shouldSkip/filterGuards), which core keeps private
function getSkipSet(controller: Constructor, handlerName: string): Set<any> | null {
  const map = getMeta<Map<string, Set<any>>>(controller, SKIP_GUARDS)
  if (!map) return null
  const methodSet = map.get(handlerName)
  const classSet = map.get('*')
  if (!methodSet && !classSet) return null
  if (methodSet && classSet) return new Set([...classSet, ...methodSet])
  return methodSet ?? classSet ?? null
}

function shouldSkip(guard: unknown, skipSet: Set<any>): boolean {
  if (skipSet.has(guard)) return true
  const factory = (guard as any)?.[GUARD_FACTORY]
  return factory != null && skipSet.has(factory)
}

function filterGuards(guards: unknown[], skipSet: Set<any> | null): unknown[] {
  if (!skipSet) return guards
  return guards.filter((g) => !shouldSkip(g, skipSet))
}

function collectGuardResponses(guards: unknown[]): Map<number, string | undefined> {
  const statuses = new Map<number, string | undefined>()
  for (const guard of guards) {
    const declared = (guard as any)?.[GUARD_RESPONSES] as GuardResponseDeclaration[] | undefined
    if (!Array.isArray(declared)) continue
    for (const decl of declared) {
      const status = typeof decl === 'number' ? decl : decl.status
      if (statuses.has(status)) continue
      statuses.set(status, typeof decl === 'number' ? undefined : decl.description)
    }
  }
  return statuses
}

// ─── $ref lifting ───────────────────────────────────────────────

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const sanitizeName = (name: string): string => name.replace(/[^a-zA-Z0-9._-]/g, '_')

function walkNodes(node: any, fn: (n: Record<string, any>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkNodes(item, fn)
    return
  }
  if (!node || typeof node !== 'object') return
  fn(node)
  for (const value of Object.values(node)) walkNodes(value, fn)
}

function hasRootRef(schema: JsonSchema): boolean {
  let found = false
  walkNodes(schema, (n) => {
    if (n.$ref === '#') found = true
  })
  return found
}

function rewriteRefs(schema: JsonSchema, refMap: Map<string, string>): void {
  walkNodes(schema, (n) => {
    if (typeof n.$ref === 'string' && refMap.has(n.$ref)) n.$ref = refMap.get(n.$ref)!
  })
}

/** Raw JSON Schema may carry a plain `meta` field, hence the callable check. */
function schemaId(schema: unknown): string | undefined {
  const meta = typeof (schema as any)?.meta === 'function' ? (schema as any).meta() : undefined
  return typeof meta?.id === 'string' ? meta.id : undefined
}
