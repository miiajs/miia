import { Injectable, Logger } from '@miiajs/core'
import { On } from '@miiajs/messaging'
import { OrderPlaced } from '../events/index.js'

@Injectable()
export class OrderAnalyticsHandler {
  private logger = new Logger('OrderAnalyticsHandler')

  totalOrders = 0
  totalRevenue = 0

  @On(OrderPlaced, { bus: 'redis', group: 'analytics', concurrency: 4 })
  async record(payload: OrderPlaced): Promise<void> {
    this.totalOrders += 1
    this.totalRevenue += payload.total
    this.logger.log(
      `[redis/analytics] recorded order ${payload.orderId} ($${payload.total}); totals: ${this.totalOrders} orders / $${this.totalRevenue}`,
    )
  }
}
