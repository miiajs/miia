// @miiajs/core - public API

// Polyfill must be first - decorators execute at module load time
import './polyfill.js'

// Application
export { Miia } from './app/index.js'
export type { MiiaOptions } from './app/index.js'

// Logger
export { LogLevel, Logger, ConsoleLogger } from './logger.js'
export type { LoggerService, LoggerConfig } from './logger.js'

// DI Container
export { Container, inject, injectOptional, runInContainerContext } from './di-container.js'
export { Resolver } from './resolver.js'

// Discovery
export { DiscoveryService } from './discovery/index.js'
export type { DiscoveredMethod, DiscoverableMethodMeta } from './discovery/index.js'

// Decorators
export { Injectable, Controller, Module } from './decorators/index.js'
export type { InjectableOptions } from './decorators/index.js'
export { Get, Post, Put, Patch, Delete, Head, Options } from './decorators/index.js'
export { Use, UseGuard, SkipGuard, ValidateBody, ValidateQuery, ValidateParams, Status } from './decorators/index.js'
export {
  createClassDecorator,
  createMethodDecorator,
  createFieldDecorator,
  createDecorator,
  applyDecorators,
} from './decorators/index.js'
export {
  getMeta,
  setMeta,
  pushMeta,
  addToMapMeta,
  setInMapMeta,
  INJECTABLE,
  MODULE,
  PREFIX,
  RESOLVED_PREFIX,
  ROUTES,
  CLASS_MW,
  METHOD_MW,
  STATUSES,
  CLASS_GUARDS,
  METHOD_GUARDS,
  SKIP_GUARDS,
  GUARD_FACTORY,
  BODY_SCHEMAS,
  QUERY_SCHEMAS,
  PARAMS_SCHEMAS,
} from './decorators/index.js'

// Router
export { Router } from './router.js'

// Middleware
export { compose } from './middleware.js'

// Exceptions
export {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnprocessableException,
  InternalServerException,
} from './exceptions.js'

// Response
export { ResponseBuilder } from './response.js'

// Built-in Middleware
export { cors } from './cors.js'

// Utilities
export { resolveOptions } from './utils/index.js'
export type { OptionsOrFactory } from './utils/index.js'

// Types
export type {
  Constructor,
  Resolve,
  Scope,
  Middleware,
  CanActivate,
  Guard,
  FactoryProvider,
  ProviderDefinition,
  ModuleOptions,
  ConfiguredModule,
  ZodLike,
  ZodLikeIssue,
  HttpMethod,
  RouteDefinition,
  RequestContext,
  ListenInfo,
  ServerHandle,
  ListenAdapter,
} from './types.js'
