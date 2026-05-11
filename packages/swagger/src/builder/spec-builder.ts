import type { Constructor, RouteDefinition, Guard, ZodLike } from '@miiajs/core'
import {
  getMeta,
  ROUTES,
  STATUSES,
  CLASS_GUARDS,
  METHOD_GUARDS,
  BODY_SCHEMAS,
  QUERY_SCHEMAS,
  PARAMS_SCHEMAS,
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

export class SpecBuilder {
  build(controllers: DiscoveredController[], options: SwaggerSetupOptions): Record<string, any> {
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
      this.processController(doc, controller, prefix, tagSet)
    }

    doc.tags = [...tagSet].map((name) => ({ name }))

    return doc
  }

  private processController(
    doc: Record<string, any>,
    controller: Constructor,
    prefix: string,
    tagSet: Set<string>,
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
              schema: convertSchema(bodySchema),
            },
          },
        }
      }

      // Responses
      const customStatus = statusMap?.get(route.handlerName)
      const explicitResponses = responseMap?.get(route.handlerName) ?? []
      const hasGuards = classGuards.length > 0 || (methodGuardMap?.get(route.handlerName)?.length ?? 0) > 0
      const hasValidation =
        !!bodySchema || !!querySchemaMap?.get(route.handlerName) || !!paramsSchemaMap?.get(route.handlerName)

      operation.responses = this.buildResponses(
        customStatus ?? (method === 'post' ? 201 : 200),
        explicitResponses,
        hasGuards,
        hasValidation,
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
        schema: param.schema ? convertSchema(param.schema) : { type: 'string' },
      })
    }

    // Auto-infer from schema for non-explicit params
    const paramsJsonSchema = paramsSchema ? convertSchema(paramsSchema) : null
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
        schema: query.schema ? convertSchema(query.schema) : { type: 'string' },
      })
    }

    // Auto-infer query from schema
    if (querySchema) {
      const queryJsonSchema = convertSchema(querySchema)
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
    hasGuards: boolean,
    hasValidation: boolean,
  ): Record<string, any> {
    const responses: Record<string, any> = {}
    const explicitStatuses = new Set(explicit.map((r) => r.status))

    // Default success response
    if (!explicitStatuses.has(defaultStatus)) {
      responses[String(defaultStatus)] = {
        description: defaultStatus === 201 ? 'Created' : 'OK',
        content: { 'application/json': { schema: {} } },
      }
    }

    // Explicit responses
    for (const res of explicit) {
      const entry: Record<string, any> = {
        description: res.description ?? statusText(res.status),
      }
      if (res.schema) {
        entry.content = {
          'application/json': { schema: convertSchema(res.schema) },
        }
      }
      responses[String(res.status)] = entry
    }

    // Auto-add 403 for guards
    if (hasGuards && !explicitStatuses.has(403)) {
      responses['403'] = { description: 'Forbidden' }
    }

    // Auto-add 422 for validation
    if (hasValidation && !explicitStatuses.has(422)) {
      responses['422'] = { description: 'Unprocessable Entity' }
    }

    return responses
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
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
  }
  return texts[code] ?? 'Response'
}
