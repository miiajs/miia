import { Injectable, Logger } from '@miiajs/core'
import { On, type MessageMeta } from '@miiajs/messaging'
import { DLQ_TOPIC } from '../orders.constants.js'
import type { PaymentCharge } from '../orders.types.js'

@Injectable()
export class PaymentDlqHandler {
  private logger = new Logger('PaymentDlqHandler')

  failures: Array<{ paymentId: string; orderId: string; lastError: string; attempts: number }> = []

  @On(DLQ_TOPIC.paymentCharge, { bus: 'redis', group: 'payments-dlq' })
  async onDlq(payload: PaymentCharge, meta: MessageMeta): Promise<void> {
    const entry = {
      paymentId: payload.paymentId,
      orderId: payload.orderId,
      lastError: meta.lastError ?? 'unknown',
      attempts: meta.attempt,
    }
    this.failures.push(entry)
    this.logger.error(
      `[redis/dlq] payment ${entry.paymentId} (order ${entry.orderId}) exhausted retries: ${entry.lastError}`,
    )
  }
}
