import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelationshipsModule } from '../relationships/relationships.module';
import { UsersModule } from '../users/users.module';
import { PhotoStorage } from './photo-storage.service';
import { Profile } from './profile.entity';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile]), UsersModule, RelationshipsModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, PhotoStorage],
  exports: [ProfilesService],
})
export class ProfilesModule {}
