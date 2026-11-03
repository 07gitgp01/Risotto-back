import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { ProfilePhoto } from './profile-photo.entity';

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_SIDE = 512;
// Rejects decompression bombs before decoding (40 megapixels).
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Stores profile photos in PostgreSQL (one per user). Every upload is decoded and
 * re-encoded: the real format is checked from the content (not the name or MIME
 * type), metadata such as EXIF GPS is dropped, and the image is resized to 512 px max.
 */
@Injectable()
export class PhotoStorage {
  private readonly maxBytes: number;

  constructor(
    config: ConfigService,
    @InjectRepository(ProfilePhoto) private readonly photos: Repository<ProfilePhoto>,
  ) {
    this.maxBytes = config.getOrThrow<AppConfig['uploads']>('uploads').photoMaxBytes;
  }

  /** Replaces the user's photo; returns the new key (it changes on every upload). */
  async save(userId: string, input: Buffer): Promise<string> {
    if (input.length > this.maxBytes) {
      throw new PayloadTooLargeException(`photo must not exceed ${this.maxBytes} bytes`);
    }
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    let format: string | undefined;
    try {
      format = (await image.metadata()).format;
    } catch {
      throw new BadRequestException('photo must be a JPEG, PNG or WebP image');
    }
    if (!format || !ACCEPTED_FORMATS.has(format)) {
      throw new BadRequestException('photo must be a JPEG, PNG or WebP image');
    }

    const data = await image
      .rotate() // Applies the EXIF orientation before metadata is dropped.
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();

    const key = `${randomUUID()}.webp`;
    await this.photos.upsert({ userId, key, data, createdAt: new Date() }, ['userId']);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    const photo = await this.photos.findOne({ where: { key }, select: { data: true } });
    if (!photo) {
      throw new Error('Photo missing for key');
    }
    return photo.data;
  }

  async remove(key: string): Promise<void> {
    await this.photos.delete({ key });
  }
}
