import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';

@Injectable()
export class RequestBodyLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestBodyLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.path.includes('/callback') || request.path.includes('/callbacks')) {
      this.logger.log('[PAYOUT_CALLBACK_PAYLOAD]', request.body);
    }

    return next.handle();
  }
}
