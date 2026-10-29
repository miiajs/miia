import { Injectable, Logger } from '@miiajs/core'
import { Idempotent, On } from '@miiajs/messaging'
import { NotificationSend } from '../events/index.js'

@Injectable()
export class NotificationHandler {
  private logger = new Logger('NotificationHandler')

  @On(NotificationSend)
  @Idempotent({
    ttl: 5 * 60 * 1000, // 5 minutes
    key: (p: NotificationSend) => `notification:${p.orderId}`,
  })
  async send(payload: NotificationSend): Promise<void> {
    this.logger.log(`[memory] sending '${payload.template}' to ${payload.to} (order ${payload.orderId})`)
    await new Promise((resolve) => setTimeout(resolve, 25))
    this.logger.log(`[memory] sent confirmation for order ${payload.orderId}`)
  }
}
