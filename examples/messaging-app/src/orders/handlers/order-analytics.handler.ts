import { Injectable, Logger } from '@miiajs/core'
import { On } from '@miiajs/messaging'
import { TOPIC } from '../orders.constants.js'
import type { OrderPlaced } from '../orders.types.js'

@Injectable()
export class OrderAnalyticsHandler {
  private logger = new Logger('OrderAnalyticsHandler')

  totalOrders = 0
  totalRevenue = 0

  @On(TOPIC.orderPlaced, { bus: 'redis', group: 'analytics', concurrency: 4 })
  async record(payload: OrderPlaced): Promise<void> {
    this.totalOrders += 1
    this.totalRevenue += payload.total
    this.logger.log(
      `[redis/analytics] recorded order ${payload.orderId} ($${payload.total}); totals: ${this.totalOrders} orders / $${this.totalRevenue}`,
    )
  }
}
