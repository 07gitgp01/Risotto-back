import { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { App } from 'supertest/types';
import { bearer, RegisteredUser } from './auth-helpers';

export async function createProfile(
  app: INestApplication<App>,
  user: RegisteredUser,
  fields: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await request(app.getHttpServer())
    .post('/api/profiles/me')
    .set(bearer(user.accessToken))
    .send({ firstName: 'Alice', lastName: 'Martin', ...fields })
    .expect(201);
  return res.body as Record<string, unknown>;
}

/** A real image in the given format, optionally carrying EXIF metadata. */
export function sampleImage(
  format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png',
  options: { width?: number; height?: number; withExif?: boolean } = {},
): Promise<Buffer> {
  const image = sharp({
    create: {
      width: options.width ?? 64,
      height: options.height ?? 48,
      channels: 3,
      background: '#E8A317',
    },
  });
  const withMeta = options.withExif
    ? image.withExif({ IFD0: { Copyright: 'secret-location', Artist: 'Alice' } })
    : image;
  return withMeta.toFormat(format).toBuffer();
}
