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
  Put,
  Query,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import {
  NotificationPage,
  NotificationsQuery,
  PreferenceView,
  RegisterDeviceDto,
  RemoveDeviceDto,
  UpdatePreferencesDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: NotificationsQuery,
  ): Promise<NotificationPage> {
    return this.notifications.list(user.id, query);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  markAllRead(@CurrentUser() user: AuthUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }

  @Get('notifications/preferences')
  getPreferences(@CurrentUser() user: AuthUser): Promise<PreferenceView[]> {
    return this.notifications.getPreferences(user.id);
  }

  @Put('notifications/preferences')
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<PreferenceView[]> {
    return this.notifications.updatePreferences(user.id, dto.preferences);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notifications.markRead(user.id, id);
  }

  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerDevice(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto): Promise<void> {
    return this.notifications.registerDevice(user.id, dto.token, dto.platform);
  }

  /** The token goes in the body: FCM tokens are long and may contain ':' characters. */
  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDevice(@CurrentUser() user: AuthUser, @Body() dto: RemoveDeviceDto): Promise<void> {
    return this.notifications.removeDevice(user.id, dto.token);
  }
}
