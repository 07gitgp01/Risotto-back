import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  // The client IP (rate limiting) comes from X-Forwarded-For, trusted only for the
  // configured proxies: 'loopback' locally (Docker), the hop count on a host like Render.
  app.set('trust proxy', config.getOrThrow<AppConfig['trustProxy']>('trustProxy'));
  app.disable('x-powered-by');
  setupApp(app);
  await app.listen(config.getOrThrow<number>('port'));
}

void bootstrap();
