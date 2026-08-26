# M-Pesa Production Configuration

## Overview
This document describes how the application uses M-Pesa production credentials and endpoints when `MPESA_ENVIRONMENT=production`.

## Environment Configuration

Set the following in your `.env` file to use production M-Pesa endpoints:

```env
MPESA_ENVIRONMENT=production
```

When `MPESA_ENVIRONMENT` is set to `production`, the application will automatically use the official Safaricom production API endpoints documented below.

## Production Endpoints (Safaricom Official)

Source: Official Safaricom production credentials email dated August 14, 2026

### Base URLs
- **Production**: `https://api.safaricom.co.ke`
- **Sandbox/Development**: `https://sandbox.safaricom.co.ke`

### Core API Endpoints (Used by Payassure)

#### OAuth2 Token Generation
- **Path**: `/oauth/v1/generate`
- **Method**: `GET`
- **Purpose**: Generate access tokens for M-Pesa API calls

#### M-Pesa Express (Lipa na M-Pesa Online - STK Push)
- **STK Push**: `/mpesa/stkpush/v1/processrequest`
- **STK Push Query**: `/mpesa/stkpushquery/v1/query`
- **Method**: `POST`
- **Purpose**: Initiate STK push payment and query payment status

#### Customer to Business (C2B)
- **C2B V1**: `/mpesa/c2b/v1/registerurl` (Traditional)
- **C2B V2**: `/mpesa/c2b/v2/registerurl` (Latest)
- **C2B Simulate**: `/mpesa/c2b/v1/simulate`
- **Method**: `POST`
- **Purpose**: Register callback URLs and simulate transactions

#### Business to Customer (B2C)
- **Path**: `/mpesa/b2c/v1/paymentrequest`
- **Method**: `POST`
- **Purpose**: Send money from business to customer

#### Business to Business (B2B)
- **Path**: `/mpesa/b2b/v1/paymentrequest`
- **Method**: `POST`
- **Purpose**: Send money from business to business

#### Reversal
- **Path**: `/mpesa/reversal/v1/request`
- **Method**: `POST`
- **Purpose**: Reverse failed transactions

#### Transaction Status Query
- **Path**: `/mpesa/transactionstatus/v1/query`
- **Method**: `POST`
- **Purpose**: Query the status of a transaction

#### Account Balance
- **Path**: `/mpesa/accountbalance/v1/query`
- **Method**: `POST`
- **Purpose**: Query account balance

#### Dynamic QR Code
- **Path**: `/mpesa/qrcode/v1/generate`
- **Method**: `POST`
- **Purpose**: Generate dynamic QR codes for payments

### Bill Manager Generic API (Not Currently Implemented)

The following endpoints are available in production but not currently used by Payassure:

- **Opt-In**: `/v1/billmanager-invoice/v1/billmanager-invoice/optin`
- **Single Invoicing**: `/v1/billmanager-invoice/v1/billmanager-invoice/single-invoicing`
- **Bulk Invoicing**: `/v1/billmanager-invoice/v1/billmanager-invoice/bulk-invoicing`
- **Reconciliation**: `/v1/billmanager-invoice/v1/billmanager-invoice/reconciliation`
- **Cancel Single Invoice**: `/v1/billmanager-invoice/v1/billmanager-invoice/cancel-single-invoice`
- **Cancel Bulk Invoice**: `/v1/billmanager-invoice/v1/billmanager-invoice/cancel-bulk-invoice`
- **Update Onboarding Details**: `/v1/billmanager-invoice/v1/billmanager-invoice/change-optin-details`
- **Update Single Invoice**: `/v1/billmanager-invoice/v1/billmanager-invoice/change-invoice`
- **Update Bulk Invoice**: `/v1/billmanager-invoice/v1/billmanager-invoice/change-invoices`

## Implementation Details

### Configuration File
Location: `src/payment/config/mpesa.env.ts`

The `MPESA_PRODUCTION_ENDPOINTS` constant contains all official production endpoints from Safaricom. These are used when `MPESA_ENVIRONMENT=production`.

### Service Implementation
Location: `src/payment/services/mpesa.service.ts`

The `MpesaService` class includes:
- `getBaseUrl(environment)`: Returns the appropriate base URL based on environment
- `getEndpointPath(endpoint, environment)`: Returns the correct endpoint path for production or sandbox
- `makeRequest(endpoint, payload)`: Makes authenticated requests to M-Pesa APIs

### Environment Switching

The service automatically switches between production and sandbox based on `MPESA_ENVIRONMENT`:

```typescript
if (environment === 'production') {
  // Use official Safaricom production endpoints
  baseUrl = 'https://api.safaricom.co.ke'
  endpoints = MPESA_PRODUCTION_ENDPOINTS
} else {
  // Use sandbox endpoints
  baseUrl = 'https://sandbox.safaricom.co.ke'
  endpoints = SANDBOX_ENDPOINTS
}
```

## Required Environment Variables

For production M-Pesa integration, ensure the following are set in your `.env`:

```env
# Environment
MPESA_ENVIRONMENT=production
NODE_ENV=production

# Safaricom Credentials (from production credentials email)
MPESA_CONSUMER_KEY=<your_production_key>
MPESA_CONSUMER_SECRET=<your_production_secret>
MPESA_SHORTCODE=<your_business_shortcode>
MPESA_PARTYA=<your_party_a>
MPESA_PASSKEY=<your_production_passkey>
MPESA_INITIATOR_NAME=<your_initiator_name>
MPESA_INITIATOR_PASSWORD=<your_initiator_password>
MPESA_CALLBACK_URL=https://<your_domain>/callbacks/mpesa
```

## Testing Production Configuration

To verify production configuration is working:

1. Check logs for environment confirmation:
   ```
   [PAYMENT][REQUEST] environment=production endpoint=stk_push url=https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest
   ```

2. Verify tokens are generated from production OAuth endpoint:
   ```
   [PAYMENT][AUTH] requesting M-Pesa access token
   ```

3. Monitor request logging in database for endpoint paths

## Migration from Sandbox to Production

When going live:

1. Update `.env` file: `MPESA_ENVIRONMENT=production`
2. Update credentials with production values from Safaricom
3. Restart the application
4. The service will automatically use production endpoints
5. Verify with test transactions

## Notes

- All production endpoints require valid Safaricom production credentials
- OAuth tokens must be generated from the production OAuth endpoint
- Different credentials are required for production vs sandbox environments
- The application logs all requests to the database for audit purposes
