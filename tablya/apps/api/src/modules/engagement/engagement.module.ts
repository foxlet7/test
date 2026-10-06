import { Module } from '@nestjs/common';
import { EngagementController } from './engagement.controller';

@Module({ controllers: [EngagementController] })
export class EngagementModule {}
