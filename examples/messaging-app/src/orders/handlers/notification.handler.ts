import { Injectable, Logger } from '@miiajs/core'
import { Idempotent, On } from '@miiajs/messaging'
import { TOPIC } from '../orders.constants.js'
import type { NotificationSend } from '../orders.types.js'

@Injectable()
export class NotificationHandler {
  private logger = new Logger('NotificationHandler')

  @On(TOPIC.notificationSend)
  @Idempotent({
    ttl: 5 * 60 * 1000, // 5 minutes
    key: (payload) => `notification:${(payload as NotificationSend).orderId}`,
  })
  async send(payload: NotificationSend): Promise<void> {
    this.logger.log(`[memory] sending '${payload.template}' to ${payload.to} (order ${payload.orderId})`)
    await new Promise((resolve) => setTimeout(resolve, 25))
    this.logger.log(`[memory] sent confirmation for order ${payload.orderId}`)
  }
}
