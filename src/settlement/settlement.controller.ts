import { Controller, Post, Get, Param, Body, Headers, UseGuards, BadRequestException, Req, UnauthorizedException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth, ApiHeader, ApiBody } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { AuthenticateDto } from './dto/authenticate.dto';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';
import { ReconcileSettlementDto } from './dto/reconcile-settlement.dto';
import PaymentCallbackDto from './dto/payment-callback.dto';
import PaymentConfirmationDto from './dto/payment-confirmation.dto';
import B2bPayoutDispatchDto from './dto/b2b-payout.dto';
import B2bPayoutCallbackDto from './dto/b2b-payout-callback.dto';
import { RunScenarioDto, RunScenarioResponseDto } from './dto/run-scenario.dto';
import {
  AuthenticateResponseDto,
  SettlementResponseDto,
  TrackSettlementResponseDto,
  ReconcileResponseDto,
  ErrorResponseDto,
} from './dto/settlement-response.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('settlement')
@Controller('settlement')
export class SettlementController {
  private readonly logger = new Logger(SettlementController.name);

  constructor(private readonly settlementService: SettlementService) {}

  /**
   * ENDPOINT 1: Authenticate Business
   * Verify API credentials and receive one-time token
   */
  @Post('authenticate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Authenticate business with API credentials',
    description:
      'Verify API key and secret to receive a one-time token for settlement operations. Token expires in 1 hour and can only be used once.',
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful. Returns a one-time token and business profile details. Use this token in the x-settlement-session header for the initiate endpoint.',
    type: AuthenticateResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid API credentials',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Business not found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Business account not in LIVE status',
    type: ErrorResponseDto,
  })
  async authenticate(@Body() body: AuthenticateDto, @Req() req: any): Promise<AuthenticateResponseDto> {
    const user = req.user;
    return this.settlementService.authenticate(body, user);
  }

  async authenticateSupplier(@Body() body: AuthenticateDto, @Req() req: any) {
    return this.settlementService.authenticateSupplier(body, req?.user ?? req);
  }

  async getSupplierSettlements(sessionToken: string) {
    return this.settlementService.getSupplierSettlements(sessionToken);
  }

  /**
   * ENDPOINT 2: Initiate Settlement
   * Submit settlement payload with one-time token
   */
  @Post('initiate-settlement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiHeader({
    name: 'x-settlement-session',
    description: 'Settlement session token obtained from settlement authenticate. This is not a bearer token.',
    required: true,
  })
  @ApiOperation({
    summary: 'Initiate a settlement request',
    description:
      'Submit settlement payload using both a user access token and a settlement session token. The access token must be sent as a bearer Authorization header and the settlement session token must be sent in the x-settlement-session header.',
  })
  @ApiBody({
    description: 'Retailer settlement initiation payload submitted to PayAssure.',
    schema: {
      example: {
        merchantId: 'pay_d68f568ddc7d7b2a',
        merchantTransactionReference: 'TXN-20260703-000001',
        totalAmount: 16500,
        currency: 'KES',
        settlementMethod: 'BANK_TRANSFER',
        description: 'Daily settlement batch',
        paymentMethod: {
          type: 'MPESA',
          payerPhoneNumber: '254712345678',
          provider: 'Safaricom',
        },
        callbackUrl: 'https://merchant.example.com/api/payassure/callback',
        transactionDate: '2026-07-03T17:30:15+03:00',
        metadata: {
          branchId: 'BR-01',
          terminalId: 'POS-03',
        },
        suppliers: [
          {
            supplierMerchantId: 'SUP-1001',
            supplierTotalAmount: 7200,
            retailerTotalAmount: 900,
            platformFee: 64.8,
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Settlement initiated successfully. Returns the created settlement record, merchant and payment breakdown, supplier settlement children, and processing details.',
    type: SettlementResponseDto,
    schema: {
      example: {
        success: true,
        settlement: {
          settlementId: 'cmr8yjs6g0007axv90bap9n48',
          merchantId: 'pay_d68f568ddc7d7b2a',
          status: 'INITIATED',
          amount: 16500,
          retailerAmount: 1200,
          supplierAmount: 15000,
          systemAmount: 300,
          paymentDetails: {
            type: 'MPESA',
            payerPhoneNumber: '254712345678',
            provider: 'Safaricom',
          },
          currency: 'KES',
          reference: 'PASTL-20260706082812-EE8AE32E',
          createdAt: '2026-07-06T08:28:12.520Z',
          estimatedProcessingTime: '24-48 hours',
        },
        message: 'Settlement request received and queued for processing',
        children: [
          {
            id: 'cmr8yjs6z0008axv9e4jvi7w3',
            amount: 15000,
            reference: 'TXN-20260703-000003-pay_d68f568ddc7d7b2a',
            supplierMerchantId: 'pay_d68f568ddc7d7b2a',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid settlement data',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access token or invalid settlement session token',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Duplicate settlement reference',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error during settlement initiation',
    type: ErrorResponseDto,
  })
  async initiateSettlement(
    @Body() body: InitiateSettlementDto,
    @Headers('x-settlement-session') settlementSessionToken: string,
  ): Promise<SettlementResponseDto> {
    return this.settlementService.initiateSettlement(settlementSessionToken, body);
  }

  @Post('payment-callback')
  @ApiOperation({ summary: 'Receive a payment provider callback', description: 'Accepts payment provider callbacks and updates the linked settlement to pending processing.' })
  @ApiResponse({ status: 200, description: 'Payment callback processed successfully.' })
  @ApiResponse({ status: 404, description: 'Settlement was not found for the supplied merchant transaction reference.' })
  async paymentCallback(@Body() body: PaymentCallbackDto): Promise<any> {
    return this.settlementService.handlePaymentCallback(body);
  }

  @Post('internal/settlements/payment-confirmation')
  @ApiOperation({ summary: 'Confirm that a settlement was paid by the customer', description: 'Accepts a payment confirmation payload from the payment gateway and advances the settlement into ledger allocation and payout processing.' })
  @ApiResponse({ status: 200, description: 'Payment confirmation processed successfully.' })
  @ApiResponse({ status: 404, description: 'Settlement was not found for the supplied identifier.' })
  async confirmSettlementPayment(@Body() body: PaymentConfirmationDto, @Headers() headers: Record<string, string | string[] | undefined>): Promise<any> {
    const authorization = this.getHeaderValue(headers, 'authorization') ?? this.getHeaderValue(headers, 'Authorization');
    const signature = this.getHeaderValue(headers, 'x-payassure-signature') ?? this.getHeaderValue(headers, 'X-PayAssure-Signature');
    const timestamp = this.getHeaderValue(headers, 'x-payassure-timestamp') ?? this.getHeaderValue(headers, 'X-PayAssure-Timestamp');

    this.logger.log(`[CONFIRMATION][REQUEST] incoming settlement confirmation body=${JSON.stringify({ settlementId: body.settlementId, paymentId: body.paymentId, status: body.status, provider: body.provider, paidAmount: body.paidAmount, paidAt: body.paidAt })}`);
    this.logger.log(`[CONFIRMATION][REQUEST] headers authorization=${authorization ?? 'missing'} signature=${signature ?? 'missing'} timestamp=${timestamp ?? 'missing'}`);

    const expectedToken = process.env.PAYMENT_GATEWAY_API_TOKEN || process.env.SETTLEMENT_API_TOKEN || process.env.INTERNAL_GATEWAY_TOKEN;
    const expectedSecret = process.env.PAYMENT_GATEWAY_SIGNATURE_SECRET || process.env.SETTLEMENT_SIGNATURE_SECRET || process.env.PAYASSURE_INTERNAL_SECRET;

    if (!authorization || !authorization.startsWith('Bearer ')) {
      this.logger.warn(`[CONFIRMATION][AUTH] missing or malformed bearer token for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Missing bearer token', error: 'UNAUTHORIZED' });
    }

    if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
      this.logger.warn(`[CONFIRMATION][AUTH] invalid bearer token for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid bearer token', error: 'UNAUTHORIZED' });
    }

    if (!expectedSecret) {
      this.logger.warn(`[CONFIRMATION][AUTH] signature secret not configured for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Signature secret is not configured', error: 'UNAUTHORIZED' });
    }

    if (!signature || !timestamp) {
      this.logger.warn(`[CONFIRMATION][AUTH] missing signature headers for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Missing signature headers', error: 'UNAUTHORIZED' });
    }

    const signatureBody = {
      paymentId: body.paymentId,
      settlementId: body.settlementId,
      status: body.status,
      provider: body.provider,
      paidAmount: body.paidAmount,
      paidAt: body.paidAt,
    } as Record<string, unknown>;
    const bodyString = JSON.stringify(signatureBody);
    const expectedSignature = crypto.createHmac('sha256', expectedSecret).update(bodyString).digest('hex');

    this.logger.log(
      `[CONFIRMATION][AUTH] signingMethod=crypto.createHmac('sha256', secret).update(bodyString).digest('hex') secretSource=${expectedSecret ? 'configured' : 'missing'} bodyString=${bodyString} algorithm=HMAC-SHA256 computedSignature=${expectedSignature} expectedToken=${expectedToken ?? 'missing'} timestamp=${timestamp} token=${authorization} for ${body.settlementId}`,
    );

    if (expectedSignature !== signature) {
      const authMethod = authorization ? String(authorization).split(' ')[0] : 'missing';
      this.logger.warn(
        `[CONFIRMATION][AUTH] signature mismatch for ${body.settlementId}: expected=${expectedSignature} presentedSignature=${signature} authentication=${authMethod} token=${authorization} signingMethod=crypto.createHmac('sha256', secret).update(bodyString).digest('hex') bodyString=${bodyString} algorithm=HMAC-SHA256 timestamp=${timestamp}`,
      );
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid signature', error: 'UNAUTHORIZED' });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const receivedTimestamp = Number(timestamp);
    if (!Number.isFinite(receivedTimestamp) || Math.abs(nowSeconds - receivedTimestamp) > 300) {
      this.logger.warn(`[CONFIRMATION][AUTH] stale timestamp ${timestamp} for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Expired or invalid timestamp', error: 'UNAUTHORIZED' });
    }

    this.logger.log(`[CONFIRMATION][AUTH] authenticated successfully for ${body.settlementId}`);
    return this.settlementService.confirmSettlementPayment(body);
  }

  private getHeaderValue(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
    const value = headers[key];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  @Post('payouts/dispatch')
  @ApiOperation({ summary: 'Dispatch B2B payouts for a settlement', description: 'Sends payout instructions to the configured B2B gateway using the amounts owed to each party and their saved payout details.' })
  @ApiResponse({ status: 200, description: 'B2B payouts dispatched successfully.' })
  @ApiResponse({ status: 404, description: 'Settlement not found or payment callback has not completed successfully.' })
  async dispatchB2bPayouts(@Body() body: B2bPayoutDispatchDto): Promise<any> {
    return this.settlementService.dispatchB2bPayouts(body);
  }

  @Post('payouts/callback')
  @ApiOperation({ summary: 'Receive a B2B payout callback', description: 'Accepts the provider callback for a previously dispatched payout and updates supplier/retailer payout status.' })
  @ApiResponse({ status: 200, description: 'B2B payout callback processed successfully.' })
  @ApiResponse({ status: 404, description: 'Payout reference or settlement not found.' })
  async b2bPayoutCallback(@Body() body: B2bPayoutCallbackDto): Promise<any> {
    return this.settlementService.handleB2bPayoutCallback(body);
  }

  /**
   * ENDPOINT 3: Track Settlement Status
   * Get current status of a settlement
   */
  @Get('track/:settlementId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Track settlement status',
    description: 'Retrieve current status and transaction details for a settlement',
  })
  @ApiResponse({
    status: 200,
    description: 'Settlement status retrieved successfully. Returns current status and transaction summary.',
    type: TrackSettlementResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing authentication token',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Settlement not found',
    type: ErrorResponseDto,
  })
  async trackSettlement(@Param('settlementId') settlementId: string, view: 'retailer' | 'supplier' | 'payassure' = 'retailer'): Promise<any> {
    return this.settlementService.trackSettlement(settlementId, view);
  }

  /**
   * ENDPOINT 4: Get Transaction Details
   * Retrieve specific transaction information
   */
  @Get('transactions/:transactionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get transaction details',
    description: 'Retrieve detailed information about a specific transaction',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction details retrieved successfully.',
    type: Object,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Transaction not found',
    type: ErrorResponseDto,
  })
  async getTransaction(@Param('transactionId') transactionId: string) {
    return this.settlementService.getTransaction(transactionId);
  }

  /**
   * ENDPOINT 5: Reconcile Settlement
   * Submit bank confirmation to complete settlement
   */
  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Reconcile settlement',
    description: 'Submit bank reference and reconciliation data to confirm settlement completion',
  })
  @ApiResponse({
    status: 200,
    description: 'Settlement reconciliation successful. Returns the updated reconciliation state.',
    type: ReconcileResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Settlement not found',
    type: ErrorResponseDto,
  })
  async reconcileSettlement(@Body() body: ReconcileSettlementDto): Promise<ReconcileResponseDto> {
    return this.settlementService.reconcileSettlement(body);
  }

  /**
   * Health Check Endpoint
   * Verify settlement service is running
   */
  @Post('scenarios/run')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Run a documented settlement scenario from Swagger',
    description:
      'Executes a predefined success or rejection scenario for settlement authentication and initiation. Useful for manual API testing and demonstrating how the platform behaves under fake or real credentials.',
  })
  @ApiResponse({ status: 200, description: 'Scenario executed successfully', type: RunScenarioResponseDto })
  @ApiResponse({ status: 400, description: 'Scenario request validation failed', type: ErrorResponseDto })
  async runScenario(@Body() body: RunScenarioDto): Promise<RunScenarioResponseDto> {
    const scenario = body.scenario;
    const credentialMode = body.credentialMode ?? 'fake';
    const apiKey = body.apiKey ?? 'pk_live_test123';
    const apiSecret = body.apiSecret ?? 'sk_live_test123';
    const merchantTransactionReference = body.merchantTransactionReference ?? `TXN-${scenario}`;
    const sessionToken = body.sessionToken ?? 'session-1';

    try {
      const authResult = await this.settlementService.authenticate({ apiKey, apiSecret } as AuthenticateDto, { email: body.userEmail ?? 'merchant@example.com' });
      const token = authResult.token;

      if (scenario === 'happy-path') {
        const result = await this.settlementService.initiateSettlement(token, {
          merchantTransactionReference,
          totalAmount: body.totalAmount ?? 7200,
          currency: body.currency ?? 'KES',
          settlementMethod: body.settlementMethod ?? 'BANK_TRANSFER',
          paymentMethod: {
            type: body.paymentMethodType ?? 'MPESA',
            payerPhoneNumber: body.payerPhoneNumber ?? '254700000000',
          },
          transactionDate: '2026-07-03T17:30:15+03:00',
          suppliers: [
            {
              supplierMerchantId: body.supplierMerchantId ?? 'SUP-1001',
              items: [{ itemId: body.itemId ?? 'ITEM-001', supplierAmount: body.supplierAmount ?? 7200 }],
            },
          ],
        } as InitiateSettlementDto);

        return {
          status: 'passed',
          scenario,
          message: 'Happy-path settlement scenario completed successfully.',
          details: { credentialMode, settlementId: result.settlement?.settlementId, merchantTransactionReference, token },
        };
      }

      if (scenario === 'expired-session') {
        try {
          await this.settlementService.initiateSettlement(sessionToken, {
            merchantTransactionReference,
            totalAmount: body.totalAmount ?? 7200,
            currency: body.currency ?? 'KES',
            settlementMethod: body.settlementMethod ?? 'BANK_TRANSFER',
            paymentMethod: {
              type: body.paymentMethodType ?? 'MPESA',
              payerPhoneNumber: body.payerPhoneNumber ?? '254700000000',
            },
            transactionDate: '2026-07-03T17:30:15+03:00',
            suppliers: [{ supplierMerchantId: body.supplierMerchantId ?? 'SUP-1001', items: [{ itemId: body.itemId ?? 'ITEM-001', supplierAmount: body.supplierAmount ?? 7200 }] }],
          } as InitiateSettlementDto);
          return { status: 'failed', scenario, message: 'Expired-session scenario unexpectedly succeeded.' };
        } catch (error: any) {
          return {
            status: 'passed',
            scenario,
            message: 'Expired-session scenario rejected as expected.',
            details: { credentialMode, error: error?.response?.message ?? error?.message },
          };
        }
      }

      if (scenario === 'invalid-payload') {
        try {
          await this.settlementService.initiateSettlement(token, {
            merchantTransactionReference,
            totalAmount: 0,
            currency: body.currency ?? 'KES',
            settlementMethod: body.settlementMethod ?? 'BANK_TRANSFER',
            paymentMethod: {
              type: body.paymentMethodType ?? 'MPESA',
              payerPhoneNumber: body.payerPhoneNumber ?? '254700000000',
            },
            transactionDate: '2026-07-03T17:30:15+03:00',
            suppliers: [{ supplierMerchantId: body.supplierMerchantId ?? 'SUP-1001', items: [{ itemId: body.itemId ?? 'ITEM-001', supplierAmount: body.supplierAmount ?? 7200 }] }],
          } as InitiateSettlementDto);
          return { status: 'failed', scenario, message: 'Invalid-payload scenario unexpectedly succeeded.' };
        } catch (error: any) {
          return {
            status: 'passed',
            scenario,
            message: 'Invalid-payload scenario rejected as expected.',
            details: { credentialMode, error: error?.response?.message ?? error?.message },
          };
        }
      }
    } catch (error: any) {
      if (scenario === 'invalid-credentials') {
        return {
          status: 'passed',
          scenario,
          message: 'Invalid credentials scenario rejected as expected.',
          details: { credentialMode, error: error?.response?.message ?? error?.message },
        };
      }

      return {
        status: 'failed',
        scenario,
        message: 'Scenario execution failed unexpectedly.',
        details: { credentialMode, error: error?.response?.message ?? error?.message },
      };
    }

    if (scenario === 'invalid-credentials') {
      return { status: 'failed', scenario, message: 'Invalid credentials scenario unexpectedly succeeded.' };
    }

    return { status: 'failed', scenario, message: 'Unsupported scenario requested.' };
  }

  @Get('health')
  @ApiOperation({ summary: 'Get settlement module health status' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  getHealth() {
    return { status: 'ok' };
  }

  /**
   * Helper: Extract Bearer token from Authorization header
   */
  private extractBearerToken(authHeader: string): string {
    if (!authHeader) {
      throw new BadRequestException('Authorization header missing');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      throw new BadRequestException('Invalid authorization header format');
    }

    return parts[1];
  }
}
