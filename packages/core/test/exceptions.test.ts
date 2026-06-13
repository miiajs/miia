import { describe, expect, it } from 'bun:test'
import {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnprocessableException,
  TooManyRequestsException,
  InternalServerException,
} from '../src/index.js'

describe('HttpException', () => {
  it('should create with status, message, and details', () => {
    const err = new HttpException(418, "I'm a teapot", { hint: 'brew coffee' })
    expect(err.statusCode).toBe(418)
    expect(err.message).toBe("I'm a teapot")
    expect(err.details).toEqual({ hint: 'brew coffee' })
    expect(err).toBeInstanceOf(Error)
  })

  it('should set constructor name for stack traces', () => {
    const err = new NotFoundException('not found')
    expect(err.name).toBe('NotFoundException')

    const base = new HttpException(500, 'err')
    expect(base.name).toBe('HttpException')
  })

  it('should work without details', () => {
    const err = new HttpException(500, 'Oops')
    expect(err.details).toBeUndefined()
  })

  it('toJSON should return structured error response', () => {
    const err = new HttpException(404, 'User not found')
    expect(err.toJSON()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'User not found',
    })
  })

  it('toJSON should include details when present', () => {
    const err = new HttpException(422, 'Validation failed', { field: 'email' })
    expect(err.toJSON()).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Validation failed',
      details: { field: 'email' },
    })
  })

  it('toJSON should fallback to "Error" for unknown status codes', () => {
    const err = new HttpException(418, "I'm a teapot")
    expect(err.toJSON().error).toBe('Error')
  })
})

describe('Built-in exceptions', () => {
  it('BadRequestException → 400', () => {
    const err = new BadRequestException()
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe('Bad Request')
  })

  it('BadRequestException with details', () => {
    const err = new BadRequestException('Invalid input', { field: 'email' })
    expect(err.statusCode).toBe(400)
    expect(err.details).toEqual({ field: 'email' })
  })

  it('UnauthorizedException → 401', () => {
    const err = new UnauthorizedException()
    expect(err.statusCode).toBe(401)
    expect(err.message).toBe('Unauthorized')
  })

  it('ForbiddenException → 403', () => {
    const err = new ForbiddenException()
    expect(err.statusCode).toBe(403)
    expect(err.message).toBe('Forbidden')
  })

  it('NotFoundException → 404', () => {
    const err = new NotFoundException('User not found')
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('User not found')
  })

  it('ConflictException → 409', () => {
    const err = new ConflictException('Already exists', { id: 1 })
    expect(err.statusCode).toBe(409)
    expect(err.details).toEqual({ id: 1 })
  })

  it('UnprocessableException → 422', () => {
    const err = new UnprocessableException()
    expect(err.statusCode).toBe(422)
    expect(err.message).toBe('Unprocessable Entity')
  })

  it('TooManyRequestsException → 429', () => {
    const err = new TooManyRequestsException()
    expect(err.statusCode).toBe(429)
    expect(err.message).toBe('Too Many Requests')
    expect(err.toJSON().error).toBe('Too Many Requests')
  })

  it('InternalServerException → 500', () => {
    const err = new InternalServerException()
    expect(err.statusCode).toBe(500)
    expect(err.message).toBe('Internal Server Error')
  })

  it('all are instances of HttpException', () => {
    const exceptions = [
      new BadRequestException(),
      new UnauthorizedException(),
      new ForbiddenException(),
      new NotFoundException(),
      new ConflictException(),
      new UnprocessableException(),
      new TooManyRequestsException(),
      new InternalServerException(),
    ]
    for (const err of exceptions) {
      expect(err).toBeInstanceOf(HttpException)
      expect(err).toBeInstanceOf(Error)
    }
  })
})
