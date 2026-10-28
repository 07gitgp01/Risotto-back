import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedContact } from '../contacts/saved-contact.entity';
import { RelationshipService } from './relationship.service';

@Module({
  imports: [TypeOrmModule.forFeature([SavedContact])],
  providers: [RelationshipService],
  exports: [RelationshipService],
})
export class ConnectionsModule {}
