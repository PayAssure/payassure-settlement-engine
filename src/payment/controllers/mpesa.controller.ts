import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MpesaPayoutControllerBase } from './mpesa-controller-operations/payout.controller.base';

@ApiTags('Payments')
@Controller('payments')
export class MpesaController extends MpesaPayoutControllerBase {}
