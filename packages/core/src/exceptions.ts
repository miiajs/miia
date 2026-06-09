const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

export class HttpException extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
  }

  toJSON(): Record<string, unknown> {
    return {
      statusCode: this.statusCode,
      error: STATUS_TEXT[this.statusCode] ?? 'Error',
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request', details?: unknown) {
    super(400, message, details)
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized', details?: unknown) {
    super(401, message, details)
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden', details?: unknown) {
    super(403, message, details)
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'Not Found', details?: unknown) {
    super(404, message, details)
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, message, details)
  }
}

export class PayloadTooLargeException extends HttpException {
  constructor(message = 'Payload Too Large', details?: unknown) {
    super(413, message, details)
  }
}

export class UnprocessableException extends HttpException {
  constructor(message = 'Unprocessable Entity', details?: unknown) {
    super(422, message, details)
  }
}

export class InternalServerException extends HttpException {
  constructor(message = 'Internal Server Error', details?: unknown) {
    super(500, message, details)
  }
}
