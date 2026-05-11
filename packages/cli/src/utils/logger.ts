import { consola } from 'consola'
import { colors } from 'consola/utils'

export const logger = {
  info: (msg: string) => consola.log(msg),
  success: (msg: string) => consola.log(colors.green(msg)),
  error: (msg: string) => consola.log(colors.red(msg)),
  warn: (msg: string) => consola.log(colors.yellow(msg)),
  box: (msg: string) => consola.box(msg),
}
