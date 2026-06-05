import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuditModule } from '../infra/audit/audit.module';

@Module({
  // Phase 7·F — UsersService records `profile.updated` on each PATCH; needs
  // AuditService in scope.
  imports: [AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
