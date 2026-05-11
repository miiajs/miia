export const TOPIC = {
  notificationSend: 'notification.send',
  orderPlaced: 'order.placed',
  paymentCharge: 'payment.charge',
} as const

export const DLQ_TOPIC = {
  paymentCharge: `${TOPIC.paymentCharge}.dlq`,
} as const
