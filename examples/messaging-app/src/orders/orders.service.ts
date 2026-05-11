import { randomUUID } from 'node:crypto'
import { Injectable, inject } from '@miiajs/core'
import { MessageBus, getMessageBusToken } from '@miiajs/messaging'
import { TOPIC } from './orders.constants.js'
import type { NotificationSend, OrderPlaced, PaymentCharge } from './orders.types.js'

@Injectable()
export class OrdersService {
  private memoryBus = inject(MessageBus)
  private redisBus = inject<MessageBus>(getMessageBusToken('redis') as string)

  async placeOrder(input: { orderId?: string; customerEmail: string; total: number; items: OrderPlaced['items'] }) {
    const orderId = input.orderId ?? randomUUID()

    const orderEvent: OrderPlaced = {
      orderId,
      customerEmail: input.customerEmail,
      total: input.total,
      items: input.items,
    }

    // Durable, multi-consumer event - goes to Redis Streams.
    await this.redisBus.publish(TOPIC.orderPlaced, orderEvent, {
      correlationId: orderId,
      // Synthetic W3C trace context for demonstration purposes.
      traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    })

    // Internal in-process notification, idempotent by orderId.
    const notification: NotificationSend = {
      orderId,
      to: input.customerEmail,
      template: 'order-confirmation',
    }
    await this.memoryBus.publish(TOPIC.notificationSend, notification, { correlationId: orderId })

    return { orderId, accepted: true }
  }

  async sendDuplicateNotification(orderId: string, customerEmail: string) {
    const notification: NotificationSend = {
      orderId,
      to: customerEmail,
      template: 'order-confirmation',
    }
    // Two publishes with the same orderId; @Idempotent on the handler skips the second.
    await this.memoryBus.publish(TOPIC.notificationSend, notification)
    await this.memoryBus.publish(TOPIC.notificationSend, notification)
    return { orderId, emitted: 2 }
  }

  async chargePayment(orderId: string, amount: number) {
    const event: PaymentCharge = {
      paymentId: randomUUID(),
      orderId,
      amount,
    }
    // Flaky handler always throws → exhausts retries → goes to DLQ topic.
    await this.redisBus.publish(TOPIC.paymentCharge, event, { correlationId: orderId })
    return { paymentId: event.paymentId, orderId, status: 'queued' }
  }
}
