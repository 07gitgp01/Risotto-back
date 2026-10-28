import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Block } from '../connections/entities/block.entity';
import { Connection } from '../connections/entities/connection.entity';
import { SavedContact } from '../contacts/saved-contact.entity';
import { RelationshipService } from './relationship.service';

/** Low-level relationship lookups shared by profiles, contacts, connections, messaging. */
@Module({
  imports: [TypeOrmModule.forFeature([SavedContact, Connection, Block])],
  providers: [RelationshipService],
  exports: [RelationshipService],
})
export class RelationshipsModule {}
