import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthProvidersController } from './providers.controller';

@Module({
  controllers: [AuthProvidersController],
  providers: [
    // Default-deny across the entire API.
    // Mark explicitly-public endpoints with @Public().
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [],
})
export class AuthModule {}
