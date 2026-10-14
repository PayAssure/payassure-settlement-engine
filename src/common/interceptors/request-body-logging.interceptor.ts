import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';

@Injectable()
export class RequestBodyLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestBodyLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestPath = request.originalUrl.replace(/([?&]token=)[^&#]*/gi, '$1[REDACTED]');

    this.logger.log(`[REQUEST] ${request.method} ${requestPath}`);

    if (request.path.includes('/callback') || request.path.includes('/callbacks')) {
      this.logger.log(`[PAYOUT_CALLBACK_PAYLOAD] ${JSON.stringify(request.body)}`);
    } else if (request.path.endsWith('/retailer/float/deposits')) {
      this.logger.log(`[RETAILER_FLOAT_DEPOSIT_REQUEST_BODY] ${JSON.stringify(request.body)}`);
    }

    return next.handle();
  }
}
