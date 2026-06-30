import { Controller, Post, Get, Param, Body, Headers, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { AuthenticateDto } from './dto/authenticate.dto';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';
import { ReconcileSettlementDto } from './dto/reconcile-settlement.dto';
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
  @ApiOperation({
    summary: 'Authenticate business with API credentials',
    description:
      'Verify API key and secret to receive a one-time token for settlement operations. Token expires in 1 hour and can only be used once.',
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful. Returns a one-time token and business profile details.',
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
  async authenticate(@Body() body: AuthenticateDto): Promise<AuthenticateResponseDto> {
    return this.settlementService.authenticate(body);
  }

  /**
   * ENDPOINT 2: Initiate Settlement
   * Submit settlement payload with one-time token
   */
  @Post('initiate-settlement')
  @ApiOperation({
    summary: 'Initiate a settlement request',
    description:
      'Submit settlement payload using one-time token from authentication. Token is consumed after this request and cannot be reused.',
  })
  @ApiResponse({
    status: 201,
    description: 'Settlement initiated successfully. Returns the created settlement record and processing details.',
    type: SettlementResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid settlement data',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired, or already used token',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Duplicate settlement reference',
    type: ErrorResponseDto,
  })
  async initiateSettlement(
    @Headers('authorization') authHeader: string,
    @Body() body: InitiateSettlementDto,
  ): Promise<SettlementResponseDto> {
    // Extract token from "Bearer token" header
    const token = this.extractBearerToken(authHeader);
    return this.settlementService.initiateSettlement(token, body);
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
