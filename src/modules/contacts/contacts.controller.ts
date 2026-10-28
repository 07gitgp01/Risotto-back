import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import { ContactCard } from './contact-card';
import { ContactsService } from './contacts.service';
import {
  QrCodeView,
  SavedContactView,
  ScanQrDto,
  ScanResult,
  UpdateContactDto,
} from './dto/contacts.dto';

@Controller()
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('qr/me')
  getQrCode(@CurrentUser() user: AuthUser): Promise<QrCodeView> {
    return this.contacts.getQrCode(user.id);
  }

  @Post('qr/me/rotate')
  @HttpCode(HttpStatus.OK)
  rotateQrCode(@CurrentUser() user: AuthUser): Promise<QrCodeView> {
    return this.contacts.rotateQrCode(user.id);
  }

  // Tokens are 256-bit random, but scans are still capped to discourage guessing.
  @Post('qr/scan')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  scan(@CurrentUser() user: AuthUser, @Body() dto: ScanQrDto): Promise<ScanResult> {
    return this.contacts.scan(user.id, dto);
  }

  @Get('contacts/card/me')
  getOwnCard(@CurrentUser() user: AuthUser): Promise<ContactCard> {
    return this.contacts.getOwnCard(user.id);
  }

  @Get('contacts')
  list(@CurrentUser() user: AuthUser): Promise<SavedContactView[]> {
    return this.contacts.list(user.id);
  }

  @Patch('contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateNote(
    @CurrentUser() user: AuthUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateContactDto,
  ): Promise<void> {
    return this.contacts.updateNote(user.id, contactId, dto.note ?? null);
  }

  @Delete('contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ): Promise<void> {
    return this.contacts.remove(user.id, contactId);
  }
}
