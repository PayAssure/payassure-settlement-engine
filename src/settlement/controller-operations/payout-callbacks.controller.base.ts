import { Body, Param, Post, UsePipes } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from '@nestjs/swagger';
import B2bPayoutCallbackDto from '../dto/b2b-payout-callback.dto';
import { MpesaCallbackTransformPipe } from '../pipes/mpesa-callback-transform.pipe';
import { PayoutDispatchControllerBase } from './payout-dispatch.controller.base';

export abstract class PayoutCallbacksControllerBase extends PayoutDispatchControllerBase {
  @Post('payouts/callback')
  @ApiExcludeEndpoint()
  @UsePipes(new MpesaCallbackTransformPipe())
  @ApiOperation({ summary: 'Receive a B2B payout callback', description: 'Accepts the provider callback for a previously dispatched payout and updates supplier/retailer payout status.' })
  @ApiResponse({ status: 200, description: 'B2B payout callback processed successfully.' })
  @ApiResponse({ status: 404, description: 'Payout reference or settlement not found.' })
  async b2bPayoutCallbackBase(@Body() body: B2bPayoutCallbackDto): Promise<any> {
    return this.settlementService.handleB2bPayoutCallback(body, undefined);
  }

  @Post('payouts/callback/:callbackIdentifier')
  @ApiExcludeEndpoint()
  @UsePipes(new MpesaCallbackTransformPipe())
  @ApiOperation({ summary: 'Receive a B2B payout callback with identifier', description: 'Accepts the provider callback for a previously dispatched payout and updates supplier/retailer payout status.' })
  @ApiResponse({ status: 200, description: 'B2B payout callback processed successfully.' })
  @ApiResponse({ status: 404, description: 'Payout reference or settlement not found.' })
  async b2bPayoutCallbackWithId(@Body() body: B2bPayoutCallbackDto, @Param('callbackIdentifier') callbackIdentifier: string): Promise<any> {
    return this.settlementService.handleB2bPayoutCallback(body, decodeURIComponent(callbackIdentifier));
  }

  @Post('payouts/callback/:callbackIdentifier/callbacks/mpesa')
  @ApiExcludeEndpoint()
  @UsePipes(new MpesaCallbackTransformPipe())
  @ApiOperation({ summary: 'Receive a B2B payout callback via M-Pesa', description: 'Accepts the provider callback for a previously dispatched payout and updates supplier/retailer payout status.' })
  @ApiResponse({ status: 200, description: 'B2B payout callback processed successfully.' })
  @ApiResponse({ status: 404, description: 'Payout reference or settlement not found.' })
  async b2bPayoutCallbackMpesa(@Body() body: B2bPayoutCallbackDto, @Param('callbackIdentifier') callbackIdentifier: string): Promise<any> {
    return this.settlementService.handleB2bPayoutCallback(body, decodeURIComponent(callbackIdentifier));
  }
}
