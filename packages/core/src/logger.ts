// ─── Log Levels ─────────────────────────────────────────────────

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  LOG = 2,
  DEBUG = 3,
}

// ─── Logger Interface ────────────────────────────────────────────

export interface LoggerService {
  log(message: string, context?: string): void

  error(message: string, trace?: string, context?: string): void

  warn(message: string, context?: string): void

  debug?(message: string, context?: string): void
}

// ─── Logger Config ──────────────────────────────────────────────

export interface LoggerConfig {
  level?: LogLevel
  json?: boolean
  appName?: string
  /** ANSI colors in the text format. Default: on, unless `NO_COLOR` is set. */
  colors?: boolean
}

// ─── ANSI Colors ─────────────────────────────────────────────────

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const

type Palette = Record<keyof typeof ansi, string>

const plain = Object.fromEntries(Object.keys(ansi).map((key) => [key, ''])) as Palette

/** `NO_COLOR` (no-color.org) set to anything but an empty string. Deno reads it without `--allow-env`. */
function noColor(): boolean {
  if ('Deno' in globalThis) return globalThis.Deno.noColor
  const value = typeof process !== 'undefined' ? process.env?.NO_COLOR : undefined
  return value !== undefined && value !== ''
}

// ─── Default Console Logger (colored format) ────────────────────

export class ConsoleLogger implements LoggerService {
  private level: LogLevel
  private json: boolean
  private appName: string
  private color: Palette
  private lastTimestamp = Date.now()

  constructor(config?: LoggerConfig) {
    this.level = config?.level ?? LogLevel.LOG
    this.json = config?.json ?? false
    this.appName = config?.appName ?? 'Miia'
    this.color = (config?.colors ?? !noColor()) ? ansi : plain
  }

  log(message: string, context?: string): void {
    if (LogLevel.LOG > this.level) return
    this.json ? this.printJson('LOG', message, context) : this.print('LOG', message, context, this.color.green)
  }

  error(message: string, trace?: string, context?: string): void {
    if (LogLevel.ERROR > this.level) return
    this.json ? this.printJson('ERROR', message, context, trace) : this.printError(message, trace, context)
  }

  warn(message: string, context?: string): void {
    if (LogLevel.WARN > this.level) return
    this.json ? this.printJson('WARN', message, context) : this.print('WARN', message, context, this.color.yellow)
  }

  debug(message: string, context?: string): void {
    if (LogLevel.DEBUG > this.level) return
    this.json ? this.printJson('DEBUG', message, context) : this.print('DEBUG', message, context, this.color.magenta)
  }

  private printError(message: string, trace?: string, context?: string): void {
    this.print('ERROR', message, context, this.color.red)
    if (trace) console.error(`${this.color.red}${trace}${this.color.reset}`)
  }

  private print(level: string, message: string, context?: string, levelColor: string = ''): void {
    const color = this.color
    const pid = typeof process !== 'undefined' ? process.pid : 0
    const now = Date.now()
    const d = new Date(now)
    const yyyy = d.getFullYear()
    const MM = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    let hh = d.getHours()
    const ampm = hh >= 12 ? 'PM' : 'AM'
    hh = hh % 12 || 12
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    const timestamp = `${yyyy}-${MM}-${dd} ${String(hh).padStart(2, '0')}:${mm}:${ss}.${ms} ${ampm}`

    const delta = now - this.lastTimestamp
    this.lastTimestamp = now
    const deltaStr = delta >= 1000 ? `+${(delta / 1000).toFixed(1)}s` : `+${delta}ms`
    const ctx = context ? `${color.yellow}[${context}]${color.reset} ` : ''
    const method = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log

    method(
      `${levelColor}[${this.appName}]${color.reset} ` +
        `${pid} ${timestamp} ` +
        `${levelColor}${level.padEnd(5)}${color.reset} ` +
        `${ctx}` +
        `${levelColor}${message}${color.reset} ` +
        `${color.yellow}${deltaStr}${color.reset}`,
    )
  }

  private printJson(level: string, message: string, context?: string, trace?: string): void {
    const entry: Record<string, unknown> = {
      app: this.appName,
      level,
      message,
      ...(context && { context }),
      ...(trace && { trace }),
      timestamp: new Date().toISOString(),
      pid: typeof process !== 'undefined' ? process.pid : 0,
    }
    const method = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log
    method(JSON.stringify(entry))
  }
}

// ─── Logger (for use in services/controllers) ────────────────────

export class Logger implements LoggerService {
  private static instance: LoggerService = new ConsoleLogger()

  constructor(private context?: string) {}

  log(message: string, context?: string): void {
    Logger.instance.log(message, context ?? this.context)
  }

  error(message: string, trace?: string, context?: string): void {
    Logger.instance.error(message, trace, context ?? this.context)
  }

  warn(message: string, context?: string): void {
    Logger.instance.warn(message, context ?? this.context)
  }

  debug(message: string, context?: string): void {
    Logger.instance.debug?.(message, context ?? this.context)
  }

  static setLogger(logger: LoggerService): void {
    Logger.instance = logger
  }

  static getLogger(): LoggerService {
    return Logger.instance
  }
}
