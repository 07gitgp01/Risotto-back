import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelationshipsModule } from '../relationships/relationships.module';
import { Profile } from '../profiles/profile.entity';
import { User } from '../users/user.entity';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { SavedContact } from './saved-contact.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SavedContact, User, Profile]), RelationshipsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
