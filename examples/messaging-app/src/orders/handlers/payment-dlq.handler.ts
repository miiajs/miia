import { Injectable, Logger } from '@miiajs/core'
import { dlqEvent, On, type MessageMeta } from '@miiajs/messaging'
import { PaymentCharge } from '../events/index.js'

@Injectable()
export class PaymentDlqHandler {
  private logger = new Logger('PaymentDlqHandler')

  failures: Array<{ paymentId: string; orderId: string; lastError: string; attempts: number }> = []

  // A dead letter can be a payload that failed the schema, so it arrives as `unknown` and is read here.
  @On(dlqEvent(PaymentCharge), { bus: 'redis', group: 'payments-dlq' })
  async onDlq(payload: unknown, meta: MessageMeta): Promise<void> {
    const lastError = meta.lastError ?? 'unknown'
    const parsed = PaymentCharge.schema.safeParse(payload)
    if (!parsed.success) {
      this.logger.error(
        `[redis/dlq] payment record that does not match the schema: ${lastError}`,
        JSON.stringify(payload),
      )
      return
    }
    const entry = {
      paymentId: parsed.data.paymentId,
      orderId: parsed.data.orderId,
      lastError,
      attempts: meta.attempt,
    }
    this.failures.push(entry)
    this.logger.error(
      `[redis/dlq] payment ${entry.paymentId} (order ${entry.orderId}) exhausted retries: ${entry.lastError}`,
    )
  }
}
