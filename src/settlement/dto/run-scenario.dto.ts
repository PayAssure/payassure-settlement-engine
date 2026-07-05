import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export enum SettlementScenarioType {
  HAPPY_PATH = 'happy-path',
  INVALID_CREDENTIALS = 'invalid-credentials',
  EXPIRED_SESSION = 'expired-session',
  INVALID_PAYLOAD = 'invalid-payload',
}

export enum SettlementCredentialMode {
  FAKE = 'fake',
  REAL = 'real',
}

export class RunScenarioDto {
  @ApiProperty({
    enum: SettlementScenarioType,
    example: SettlementScenarioType.HAPPY_PATH,
    description: 'Choose the settlement scenario to execute from Swagger. Happy-path validates the full flow, while the others intentionally trigger rejection behavior.',
    examples: {
      'happy-path': { value: SettlementScenarioType.HAPPY_PATH, summary: 'Runs a complete settlement success flow.' },
      'invalid-credentials': { value: SettlementScenarioType.INVALID_CREDENTIALS, summary: 'Exercises authentication failure with bad API credentials.' },
      'expired-session': { value: SettlementScenarioType.EXPIRED_SESSION, summary: 'Exercises session expiry handling for settlement initiation.' },
      'invalid-payload': { value: SettlementScenarioType.INVALID_PAYLOAD, summary: 'Exercises validation failure with an invalid settlement request.' },
    },
  })
  @IsEnum(SettlementScenarioType)
  scenario: SettlementScenarioType = SettlementScenarioType.HAPPY_PATH;

  @ApiProperty({
    enum: SettlementCredentialMode,
    example: SettlementCredentialMode.FAKE,
    description: 'Use fake demo credentials for local testing, or real supplied credentials when you want to test against a configured environment.',
    examples: {
      fake: { value: SettlementCredentialMode.FAKE, summary: 'Use the built-in demo credentials for local Swagger testing.' },
      real: { value: SettlementCredentialMode.REAL, summary: 'Use your own configured credentials in a real environment.' },
    },
  })
  @IsEnum(SettlementCredentialMode)
  credentialMode: SettlementCredentialMode = SettlementCredentialMode.FAKE;

  @ApiPropertyOptional({
    example: 'pk_live_test123',
    description: 'API key to use when credentialMode is real. If omitted, a fake demo key is used.',
    examples: {
      fake: { value: 'pk_live_test123', summary: 'Demo API key used by the local scenario runner.' },
      real: { value: 'pk_live_your_real_key', summary: 'Real API key for a production-like environment.' },
    },
  })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({
    example: 'sk_live_test123',
    description: 'API secret to use when credentialMode is real. If omitted, a fake demo secret is used.',
    examples: {
      fake: { value: 'sk_live_test123', summary: 'Demo API secret used by the local scenario runner.' },
      real: { value: 'sk_live_your_real_secret', summary: 'Real API secret for a production-like environment.' },
    },
  })
  @IsOptional()
  @IsString()
  apiSecret?: string;

  @ApiPropertyOptional({
    example: 'merchant@example.com',
    description: 'Email to use for the auth context while executing the scenario. This is used by the auth layer to match the owner of the provided credentials.',
    examples: {
      demo: { value: 'merchant@example.com', summary: 'Demo merchant email used in local examples.' },
      alternate: { value: 'ops@payassure.example', summary: 'Alternate business owner email for integration testing.' },
    },
  })
  @IsOptional()
  @IsString()
  userEmail?: string;

  @ApiPropertyOptional({
    example: 'TXN-SWAGGER-001',
    description: 'Merchant transaction reference to use for the settlement attempt. This should be unique for repeatable happy-path runs.',
    examples: {
      happyPath: { value: 'TXN-SWAGGER-001', summary: 'Reference used for the success scenario.' },
      duplicateCheck: { value: 'TXN-SWAGGER-DUPLICATE', summary: 'Reference used to test duplicate settlement handling.' },
    },
  })
  @IsOptional()
  @IsString()
  merchantTransactionReference?: string;

  @ApiPropertyOptional({
    example: 7200,
    description: 'Optional override for the settlement amount used in the request payload. For the invalid-payload scenario, set this to 0 to trigger validation failure.',
    examples: {
      success: { value: 7200, summary: 'Typical successful settlement value.' },
      invalidPayload: { value: 0, summary: 'Used to force the validation failure scenario.' },
    },
  })
  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @ApiPropertyOptional({
    example: 'KES',
    description: 'Optional override for the settlement currency. Supported currencies in the demo environment are KES, USD, and TZS.',
    examples: {
      kes: { value: 'KES', summary: 'Kenyan shillings used in the primary demo flow.' },
      usd: { value: 'USD', summary: 'United States dollars for multi-currency testing.' },
      btc: { value: 'BTC', summary: 'Unsupported currency example for validation failure testing.' },
    },
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    example: 'BANK_TRANSFER',
    description: 'Optional override for the settlement method. Use BANK_TRANSFER or another supported method that your integration accepts.',
    examples: {
      bankTransfer: { value: 'BANK_TRANSFER', summary: 'Bank transfer settlement flow.' },
      cash: { value: 'CASH', summary: 'Cash-based settlement route for internal testing.' },
    },
  })
  @IsOptional()
  @IsString()
  settlementMethod?: string;

  @ApiPropertyOptional({
    example: 'MPESA',
    description: 'Optional override for the payment method type. Supported examples are MPESA and CASH.',
    examples: {
      mpesa: { value: 'MPESA', summary: 'Mobile money payout flow.' },
      cash: { value: 'CASH', summary: 'Cash-based payout flow.' },
      unsupported: { value: 'APPLEPAY', summary: 'Unsupported payment method example to trigger validation failure.' },
    },
  })
  @IsOptional()
  @IsString()
  paymentMethodType?: string;

  @ApiPropertyOptional({
    example: '254700000000',
    description: 'Optional override for the payer phone number. This is required for MPESA-based payments.',
    examples: {
      kenya: { value: '254700000000', summary: 'Kenyan mobile number for MPESA testing.' },
      empty: { value: '', summary: 'Leave empty to trigger validation failure for MPESA flows.' },
    },
  })
  @IsOptional()
  @IsString()
  payerPhoneNumber?: string;

  @ApiPropertyOptional({
    example: 'SUP-1001',
    description: 'Optional override for the supplier merchant ID. This must resolve to an active supplier integration in the demo environment.',
    examples: {
      demoSupplier: { value: 'SUP-1001', summary: 'Demo supplier merchant ID used by the happy path.' },
      missingSupplier: { value: 'SUP-999999', summary: 'Unknown supplier example for validation failure.' },
    },
  })
  @IsOptional()
  @IsString()
  supplierMerchantId?: string;

  @ApiPropertyOptional({
    example: 'ITEM-001',
    description: 'Optional override for the supplier item identifier. Each item should have a unique ID per supplier allocation.',
    examples: {
      firstItem: { value: 'ITEM-001', summary: 'First demo allocation item.' },
      secondItem: { value: 'ITEM-002', summary: 'Second demo allocation item.' },
    },
  })
  @IsOptional()
  @IsString()
  itemId?: string;

  @ApiPropertyOptional({
    example: 7200,
    description: 'Optional override for the supplier allocation amount. Used to simulate the supplier payout portion of the settlement.',
    examples: {
      successAmount: { value: 7200, summary: 'Approved supplier allocation amount.' },
      negativeAmount: { value: -500, summary: 'Negative amount example for validation failure.' },
    },
  })
  @IsOptional()
  @IsNumber()
  supplierAmount?: number;

  @ApiPropertyOptional({
    example: 'expired-session',
    description: 'Optional explicit session token for expired-session or other token-based scenarios. The demo runner uses this to simulate replayed or expired sessions.',
    examples: {
      expired: { value: 'expired-session', summary: 'Simulates a stale settlement session.' },
      valid: { value: 'session-1', summary: 'Uses the current valid session token for happy-path runs.' },
    },
  })
  @IsOptional()
  @IsString()
  sessionToken?: string;
}

export class RunScenarioResponseDto {
  @ApiProperty({ example: 'passed', description: 'Whether the scenario behaved as expected.' })
  status: string = '';

  @ApiProperty({ example: 'happy-path', description: 'The scenario that was executed.' })
  scenario: string = '';

  @ApiProperty({ example: 'Happy-path settlement scenario completed successfully.', description: 'A human-readable summary of the scenario outcome.' })
  message: string = '';

  @ApiPropertyOptional({ type: Object, example: { credentialMode: 'fake', settlementId: 'settlement-1' }, description: 'Additional scenario details such as identifiers, tokens, or error metadata.' })
  details?: Record<string, any>;
}
