import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionsModule } from '../connections/connections.module';
import { UsersModule } from '../users/users.module';
import { PhotoStorage } from './photo-storage.service';
import { Profile } from './profile.entity';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile]), UsersModule, ConnectionsModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, PhotoStorage],
  exports: [ProfilesService],
})
export class ProfilesModule {}
