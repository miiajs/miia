import { createConsola, LogLevels } from 'consola'
import { colors } from 'consola/utils'

// Fixed level: the default drops everything below warn under NODE_ENV=test, CLI errors included
const consola = createConsola({ level: LogLevels.info })

export const logger = {
  info: (msg: string) => consola.log(msg),
  success: (msg: string) => consola.log(colors.green(msg)),
  error: (msg: string) => consola.log(colors.red(msg)),
  warn: (msg: string) => consola.log(colors.yellow(msg)),
}
