import { Global, Module } from '@nestjs/common';
import { ResendAdapter } from './resend.adapter';

@Global()
@Module({
  providers: [ResendAdapter],
  exports: [ResendAdapter],
})
export class NotificationsModule {}
