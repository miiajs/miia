import { Injectable, Logger } from '@miiajs/core'
import { On, type MessageMeta } from '@miiajs/messaging'
import { TOPIC } from '../orders.constants.js'
import type { PaymentCharge } from '../orders.types.js'

@Injectable()
export class FlakyPaymentHandler {
  private logger = new Logger('FlakyPaymentHandler')

  @On(TOPIC.paymentCharge, { bus: 'redis', group: 'payments' })
  async charge(payload: PaymentCharge, meta: MessageMeta): Promise<void> {
    this.logger.warn(
      `[redis/payments] attempt #${meta.attempt} for payment ${payload.paymentId} (order ${payload.orderId})`,
    )
    throw new Error(`Payment gateway unreachable for ${payload.paymentId}`)
  }
}
