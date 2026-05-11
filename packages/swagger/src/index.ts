// @miiajs/swagger - public API

// Module
export { SwaggerModule, SWAGGER_OPTIONS } from './swagger.module.js'
export { SwaggerService } from './swagger.service.js'

// Decorators
export {
  ApiTag,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiHeader,
  ApiExclude,
} from './decorators/index.js'

// Builder (for advanced usage)
export { SpecBuilder, convertSchema, toOpenApiPath, extractPathParams } from './builder/index.js'
export type { DiscoveredController } from './builder/index.js'

// Types
export type {
  SwaggerSetupOptions,
  ApiOperationOptions,
  ApiResponseOptions,
  ApiParamOptions,
  ApiQueryOptions,
  ApiHeaderOptions,
  ApiBodyOptions,
  ApiResponseMeta,
  ApiParamMeta,
  ApiQueryMeta,
  ApiSecurityMeta,
  ApiHeaderMeta,
  JsonSchema,
} from './types.js'
