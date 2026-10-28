import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import sharp from 'sharp';
import { AppConfig } from '../../config/configuration';

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_SIDE = 512;
// Rejects decompression bombs before decoding (40 megapixels).
const MAX_INPUT_PIXELS = 40_000_000;
const KEY_PATTERN = /^[0-9a-f-]{36}\.webp$/;

/**
 * Stores profile photos on the local disk. Every upload is decoded and re-encoded:
 * the real format is checked from the content (not the name or MIME type), metadata
 * such as EXIF GPS is dropped, and the image is resized to 512 px max.
 */
@Injectable()
export class PhotoStorage implements OnModuleInit {
  private readonly dir: string;
  private readonly maxBytes: number;

  constructor(config: ConfigService) {
    const uploads = config.getOrThrow<AppConfig['uploads']>('uploads');
    this.dir = resolve(uploads.dir, 'photos');
    this.maxBytes = uploads.photoMaxBytes;
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** Returns the storage key of the normalized image. */
  async save(input: Buffer): Promise<string> {
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

    const output = await image
      .rotate() // Applies the EXIF orientation before metadata is dropped.
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();

    const key = `${randomUUID()}.webp`;
    await writeFile(this.path(key), output);
    return key;
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async remove(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => undefined);
  }

  /** Keys come from the database, but are still checked to rule out path traversal. */
  private path(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new Error('Invalid photo key');
    }
    return join(this.dir, key);
  }
}
