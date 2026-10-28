import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import { BlocksService } from './blocks.service';
import { ConnectionsService } from './connections.service';
import {
  BlockedUserView,
  BlockUserDto,
  ConnectionView,
  CreateConnectionDto,
  ListRequestsQuery,
  PaginationQuery,
  SearchQuery,
  SearchResult,
} from './dto/connections.dto';
import { SearchService } from './search.service';

@Controller()
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly blocks: BlocksService,
    private readonly searchService: SearchService,
  ) {}

  @Get('users/search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  search(@CurrentUser() user: AuthUser, @Query() query: SearchQuery): Promise<SearchResult[]> {
    return this.searchService.search(user.id, query);
  }

  @Post('connections')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  request(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConnectionDto,
  ): Promise<ConnectionView> {
    return this.connections.request(user.id, dto);
  }

  @Get('connections')
  list(@CurrentUser() user: AuthUser, @Query() page: PaginationQuery): Promise<ConnectionView[]> {
    return this.connections.listConnections(user.id, page);
  }

  @Get('connections/requests')
  listRequests(
    @CurrentUser() user: AuthUser,
    @Query() query: ListRequestsQuery,
  ): Promise<ConnectionView[]> {
    return this.connections.listRequests(user.id, query.direction, query);
  }

  @Post('connections/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConnectionView> {
    return this.connections.accept(user.id, id);
  }

  @Post('connections/:id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.connections.decline(user.id, id);
  }

  @Delete('connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.connections.remove(user.id, id);
  }

  @Post('blocks')
  @HttpCode(HttpStatus.NO_CONTENT)
  block(@CurrentUser() user: AuthUser, @Body() dto: BlockUserDto): Promise<void> {
    return this.blocks.block(user.id, dto.userId);
  }

  @Get('blocks')
  listBlocks(@CurrentUser() user: AuthUser): Promise<BlockedUserView[]> {
    return this.blocks.list(user.id);
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unblock(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.blocks.unblock(user.id, userId);
  }
}
