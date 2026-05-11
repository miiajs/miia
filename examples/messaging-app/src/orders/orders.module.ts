import { Module } from '@miiajs/core'
import { OrdersController } from './orders.controller.js'
import { OrdersService } from './orders.service.js'
import {
  FlakyPaymentHandler,
  NotificationHandler,
  OrderAnalyticsHandler,
  OrderInventoryHandler,
  PaymentDlqHandler,
} from './handlers/index.js'

@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    NotificationHandler,
    OrderAnalyticsHandler,
    OrderInventoryHandler,
    FlakyPaymentHandler,
    PaymentDlqHandler,
  ],
})
export class OrdersModule {}
