import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { MemberProfileView, OwnProfileView } from './profile-view';
import { ProfilesService } from './profiles.service';

// Hard cap for the multipart parser; the configurable limit is enforced by PhotoStorage.
const UPLOAD_HARD_CAP_BYTES = 20 * 1024 * 1024;

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me')
  getOwn(@CurrentUser() user: AuthUser): Promise<OwnProfileView> {
    return this.profiles.getOwn(user.id);
  }

  @Post('me')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProfileDto): Promise<OwnProfileView> {
    return this.profiles.create(user.id, dto);
  }

  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<OwnProfileView> {
    return this.profiles.update(user.id, dto);
  }

  @Put('me/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_HARD_CAP_BYTES, files: 1, fields: 0 },
    }),
  )
  setPhoto(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<OwnProfileView> {
    if (!file) {
      throw new BadRequestException('photo file is required');
    }
    return this.profiles.setPhoto(user.id, file.buffer);
  }

  @Delete('me/photo')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePhoto(@CurrentUser() user: AuthUser): Promise<void> {
    return this.profiles.removePhoto(user.id);
  }

  @Get(':userId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<OwnProfileView | MemberProfileView> {
    return this.profiles.getForViewer(user.id, userId);
  }

  @Get(':userId/photo')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'private, max-age=86400')
  async getPhoto(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<StreamableFile> {
    return new StreamableFile(await this.profiles.getPhoto(user.id, userId));
  }
}
