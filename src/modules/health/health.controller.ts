import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/auth.decorators';
import { HealthReport, HealthService } from './health.service';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
