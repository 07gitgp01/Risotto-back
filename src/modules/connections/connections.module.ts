import { Module } from '@nestjs/common';
import { RelationshipService } from './relationship.service';

@Module({
  providers: [RelationshipService],
  exports: [RelationshipService],
})
export class ConnectionsModule {}
