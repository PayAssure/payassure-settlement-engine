import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';

@Injectable()
export class RequestBodyLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestBodyLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    // Log raw body for callback endpoints
    if (request.path.includes('/callback') || request.path.includes('/callbacks')) {
      this.logger.log('[RAW_REQUEST_BODY] Callback request received', {
        timestamp: new Date().toISOString(),
        method: request.method,
        path: request.path,
        url: request.originalUrl,
        contentType: request.get('content-type'),
        bodyType: typeof request.body,
        bodyJSON: JSON.stringify(request.body),
        bodyKeys: Object.keys(request.body ?? {}),
        paramsKeys: Object.keys(request.params ?? {}),
        params: request.params,
      });
    }

    return next.handle();
  }
}
