import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminAccountPage, AdminStats, ListAccountsQuery } from './dto/admin.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats(): Promise<AdminStats> {
    return this.admin.stats();
  }

  @Get('users')
  list(@Query() query: ListAccountsQuery): Promise<AdminAccountPage> {
    return this.admin.listAccounts(query);
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  suspend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.admin.suspend(user.id, id);
  }

  @Post('users/:id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  reactivate(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.admin.reactivate(id);
  }
}
