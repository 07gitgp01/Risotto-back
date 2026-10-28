import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../profiles/profile.entity';
import { ProfilesModule } from '../profiles/profiles.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { User } from '../users/user.entity';
import { BlocksService } from './blocks.service';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { Block } from './entities/block.entity';
import { Connection } from './entities/connection.entity';
import { SearchService } from './search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Connection, Block, User, Profile]),
    RelationshipsModule,
    ProfilesModule,
  ],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, BlocksService, SearchService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
