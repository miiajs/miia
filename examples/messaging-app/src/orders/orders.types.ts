export interface OrderPlaced {
  orderId: string
  customerEmail: string
  total: number
  items: Array<{ sku: string; qty: number }>
}

export interface NotificationSend {
  orderId: string
  to: string
  template: 'order-confirmation'
}

export interface PaymentCharge {
  paymentId: string
  orderId: string
  amount: number
}
