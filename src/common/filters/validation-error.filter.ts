import { ExceptionFilter, Catch, ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch(BadRequestException)
export class ValidationErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ValidationErrorFilter.name);

  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();
    const exceptionResponse = exception.getResponse() as any;

    // Log validation errors
    if (exceptionResponse?.message && Array.isArray(exceptionResponse.message)) {
      this.logger.error('[VALIDATION_ERROR] Request validation failed', {
        timestamp: new Date().toISOString(),
        method: request.method,
        url: request.originalUrl,
        path: request.path,
        params: request.params,
        query: request.query,
        body: request.body,
        validationErrors: exceptionResponse.message,
        error: exceptionResponse.error,
      });
    } else if (exceptionResponse?.message) {
      this.logger.warn('[VALIDATION_ERROR] BadRequestException', {
        timestamp: new Date().toISOString(),
        method: request.method,
        url: request.originalUrl,
        path: request.path,
        message: exceptionResponse.message,
        body: request.body,
      });
    }

    response.status(400).json({
      statusCode: 400,
      message: exceptionResponse.message || 'Bad Request',
      error: exceptionResponse.error || 'Bad Request',
      path: request.originalUrl,
    });
  }
}
