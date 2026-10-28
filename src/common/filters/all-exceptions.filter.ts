import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

/** Normalises error responses and never leaks stack traces or internal messages. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body: ErrorBody =
        typeof payload === 'string'
          ? { statusCode: status, message: payload, error: exception.name }
          : {
              statusCode: status,
              message: (payload as Partial<ErrorBody>).message ?? exception.message,
              error: (payload as Partial<ErrorBody>).error ?? exception.name,
            };
      response.status(status).json(body);
      return;
    }

    // Client errors raised by Express middlewares (e.g. body too large, malformed JSON).
    const clientStatus = (exception as { status?: unknown; expose?: unknown } | null)?.status;
    if (
      typeof clientStatus === 'number' &&
      clientStatus >= 400 &&
      clientStatus < 500 &&
      (exception as { expose?: unknown }).expose === true
    ) {
      response.status(clientStatus).json({
        statusCode: clientStatus,
        message: clientStatus === 413 ? 'Payload too large' : 'Bad request',
        error: clientStatus === 413 ? 'Payload Too Large' : 'Bad Request',
      } satisfies ErrorBody);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    } satisfies ErrorBody);
  }
}
