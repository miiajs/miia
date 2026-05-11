import { Controller, Get, Post, Status, ValidateBody, inject, type RequestContext } from '@miiajs/core'
import { OrdersService } from './orders.service.js'
import { OrderAnalyticsHandler, PaymentDlqHandler } from './handlers/index.js'
import {
  ChargeSchema,
  DuplicateNotificationSchema,
  PlaceOrderSchema,
  type ChargeInput,
  type DuplicateNotificationInput,
  type PlaceOrderInput,
} from './schemas/index.js'

@Controller('/orders')
export class OrdersController {
  private orders = inject(OrdersService)
  private analytics = inject(OrderAnalyticsHandler)
  private dlq = inject(PaymentDlqHandler)

  @Post('/')
  @Status(202)
  @ValidateBody(PlaceOrderSchema)
  async place(ctx: RequestContext) {
    return this.orders.placeOrder(await ctx.json<PlaceOrderInput>())
  }

  @Post('/duplicate-notification')
  @Status(202)
  @ValidateBody(DuplicateNotificationSchema)
  async duplicateNotification(ctx: RequestContext) {
    const input = await ctx.json<DuplicateNotificationInput>()
    return this.orders.sendDuplicateNotification(input.orderId, input.customerEmail)
  }

  @Post('/charge')
  @Status(202)
  @ValidateBody(ChargeSchema)
  async charge(ctx: RequestContext) {
    const input = await ctx.json<ChargeInput>()
    return this.orders.chargePayment(input.orderId, input.amount)
  }

  @Get('/stats')
  stats() {
    return {
      analytics: {
        totalOrders: this.analytics.totalOrders,
        totalRevenue: this.analytics.totalRevenue,
      },
      dlq: {
        failures: this.dlq.failures,
      },
    }
  }
}
