import { Controller, Post, Get, Param, Body, Headers, UseGuards, BadRequestException, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { AuthenticateDto } from './dto/authenticate.dto';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';
import { ReconcileSettlementDto } from './dto/reconcile-settlement.dto';
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
          retailerAmount: 1500,
          supplierAmount: 15000,
          systemAmount: 1000,
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
  async trackSettlement(@Param('settlementId') settlementId: string): Promise<TrackSettlementResponseDto> {
    return this.settlementService.trackSettlement(settlementId);
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
