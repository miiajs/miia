import { Injectable, Logger } from '@miiajs/core'
import { Idempotent, On } from '@miiajs/messaging'
import { OrderPlaced } from '../events/index.js'

@Injectable()
export class OrderInventoryHandler {
  private logger = new Logger('OrderInventoryHandler')

  // No explicit group - the bus auto-derives `messaging-app:order.placed__OrderInventoryHandler_reserveStock`
  // (with `appName` from MessagingModule.configure). Showcases the auto-derived
  // grouping for handler-per-subscription model.
  @On(OrderPlaced, { bus: 'redis' })
  @Idempotent({
    ttl: 24 * 60 * 60 * 1000, // 24 hours
    key: (p: OrderPlaced) => `inventory:${p.orderId}`,
  })
  async reserveStock(payload: OrderPlaced): Promise<void> {
    this.logger.log(
      `[redis/inventory] reserving stock for order ${payload.orderId}: ${payload.items
        .map((i) => `${i.sku}×${i.qty}`)
        .join(', ')}`,
    )
  }
}
