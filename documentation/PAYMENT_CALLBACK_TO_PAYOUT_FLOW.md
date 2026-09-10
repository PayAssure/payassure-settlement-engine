# Payment Callback to Payout Flow

## Overview

This document describes the complete flow from M-Pesa payment callback to supplier and retailer payout dispatch with comprehensive logging.

## Architecture

```
M-Pesa Payment Callback
    ↓
Parse Callback & Update M-Pesa Transaction
    ↓
[If Successful] Call Settlement Split & Allocate Funds
    ↓
Extract Settlement Reference
    ↓
Split Funds (Supplier + Retailer Amounts)
    ↓
Dispatch B2B Payouts (Parallel)
    ├─ Query Supplier Payout Destination
    ├─ Query Retailer Payout Destination
    ├─ Send Payout to Supplier
    └─ Send Payout to Retailer
```

## Payment Callback Endpoints

### Main Callback Endpoint
**POST** `/payments/callbacks/mpesa`

Receives full M-Pesa callback payload with gateway metadata. Parses callback, updates transaction, and if successful, triggers settlement split and payout.

### Callback with Identifier
**POST** `/payments/callbacks/mpesa/{callbackIdentifier}`

Same as main callback but with a callback identifier (transaction token) in the URL path. The identifier helps match the callback to the specific STK push transaction.

### Health Check
**GET** `/payments/callbacks/mpesa`

Returns `{ ok: true }` to verify callback endpoint is active.

## Complete Flow with Logging

### Step 1: Settlement Initiated
```
[REQUEST] POST /settlement/initiate-settlement
[Nest] LOG [SettlementService] Initiate settlement requested: session=session_..., merchantTransactionReference=TXN-...
[Nest] LOG [SettlementService] Creating primary settlement with payAssureReference=PASTL-..., internalReference=MTXN-...
[Nest] LOG [SettlementService] Initiating STK push through internal payment service
[PAYMENT][REQUEST] environment=sandbox endpoint=stk_push url=https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest
[PAYMENT][RESPONSE] endpoint=stk_push status=200 data={"MerchantRequestID":"...", "CheckoutRequestID":"ws_CO_..."}
[Nest] LOG [SettlementService] STK push response received for merchantTransactionReference=TXN-...
```

### Step 2: M-Pesa Callback Received
```
[REQUEST] POST /payments/callbacks/mpesa/e3d80494-0f1a-48b9-8936-0a2545fd6bca
[Nest] LOG [PaymentCallbackController] [PAYMENT][CALLBACK] received M-Pesa callback with identifier
  {
    "timestamp": "2026-08-14T22:23:41.858Z",
    "callbackIdentifier": "e3d80494-0f1a-48b9-8936-0a2545fd6bca"
  }

[Nest] LOG [PaymentCallbackController] [PAYMENT][CALLBACK] M-Pesa callback parsed
  {
    "status": "completed",
    "resultCode": 0,
    "receipt": "LHD21AS6QV",
    "checkoutRequestId": "ws_CO_150820260123302791614036"
  }

[Nest] LOG [PaymentCallbackController] [PAYMENT][CALLBACK] M-Pesa transaction record updated
  {
    "transactionId": "cmstik6c3000e1t7unla15794",
    "status": "COMPLETED"
  }
```

### Step 3: Settlement Split and Payout Dispatch
```
[Nest] LOG [PaymentCallbackController] [PAYMENT][CALLBACK] payment successful - triggering settlement split and payout
  {
    "merchantTransactionReference": "TXN-20260703-0wzq00a0001",
    "mpesaReceipt": "LHD21AS6QV"
  }

[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] splitting funds for settlement
  {
    "merchantTransactionReference": "TXN-20260703-0wzq00a0001",
    "mpesaReceipt": "LHD21AS6QV"
  }

[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] settlement found
  {
    "settlementId": "cmstik677000d1t7uotv33ust",
    "amount": 2,
    "currency": "KES"
  }

[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] parsed settlement amounts
  {
    "settlementId": "cmstik677000d1t7uotv33ust",
    "supplierMerchantId": "pay_d68f568ddc7d7b2a",
    "supplierAmount": 1,
    "retailerAmount": 1
  }

[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] settlement marked as FUNDS_SPLIT
  {
    "settlementId": "cmstik677000d1t7uotv33ust",
    "supplierAmount": 1,
    "retailerAmount": 1
  }
```

### Step 4: Supplier Payout Dispatch
```
[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] dispatching payout to supplier
  {
    "settlementId": "cmstik677000d1t7uotv33ust",
    "supplierMerchantId": "pay_d68f568ddc7d7b2a",
    "amount": 1
  }

[Nest] LOG [SettlementService] [B2B][DISPATCH] settlement=cmstik677000d1t7uotv33ust party=SUPPLIER amount=1 recipientShortCode=600997 accountReference=John Doe

[Nest] LOG [SettlementService] [B2B][DISPATCH] payload={
  "reference": "TXN-20260703-0wzq00a0001-SUPPLIER-1723702621000",
  "merchantTransactionReference": "TXN-20260703-0wzq00a0001",
  "settlementReference": "PASTL-20260814222328-585E2BEC",
  "party": "SUPPLIER",
  "amount": 1,
  "currency": "KES",
  "recipientShortCode": "600997",
  "accountReference": "John Doe",
  "recipientType": "MPESA",
  "recipientPhoneNumber": "254712345678"
}

[Nest] LOG [SettlementService] [B2B][DISPATCH] payoutReference=TXN-20260703-0wzq00a0001-SUPPLIER-1723702621000 settled=cmstik677000d1t7uotv33ust gatewayResult={
  "success": true,
  "statusCode": 200,
  "response": {...}
}

[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] supplier payout dispatched
  {
    "settlementId": "cmstik677000d1t7uotv33ust",
    "supplierMerchantId": "pay_d68f568ddc7d7b2a",
    "payoutReference": "TXN-20260703-0wzq00a0001-SUPPLIER-1723702621000",
    "status": "DISPATCHED"
  }
```

### Step 5: Retailer Payout Dispatch
```
[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] dispatching payout to retailer
  {
    "settlementId": "cmstik677000d1t7uotv33ust",
    "amount": 1
  }

[Nest] LOG [SettlementService] [B2B][DISPATCH] settlement=cmstik677000d1t7uotv33ust party=RETAILER amount=1 recipientShortCode=4325977 accountReference=Retail Shop

[Nest] LOG [SettlementService] [B2B][DISPATCH] payload={
  "reference": "TXN-20260703-0wzq00a0001-RETAILER-1723702621500",
  "party": "RETAILER",
  "amount": 1,
  "currency": "KES",
  "recipientShortCode": "4325977",
  "accountReference": "Retail Shop",
  "recipientType": "MPESA",
  "recipientPhoneNumber": "254791614036"
}

[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] retailer payout dispatched
  {
    "settlementId": "cmstik677000d1t7uotv33ust",
    "payoutReference": "TXN-20260703-0wzq00a0001-RETAILER-1723702621500",
    "status": "DISPATCHED"
  }
```

### Step 6: Completion
```
[Nest] LOG [SettlementService] [SETTLEMENT][SPLIT] split and allocation completed
  {
    "settlementId": "cmstik677000d1t7uotv33ust",
    "supplierPayoutStatus": "DISPATCHED",
    "retailerPayoutStatus": "DISPATCHED",
    "errorCount": 0
  }

[RESPONSE] 200 OK
{
  "received": true,
  "accepted": true,
  "timestamp": "2026-08-14T22:23:41.858Z",
  "parsed": { ... },
  "transaction": { ... },
  "settlement": {
    "success": true,
    "settlementId": "cmstik677000d1t7uotv33ust",
    "merchantTransactionReference": "TXN-20260703-0wzq00a0001",
    "splitRecord": { ... },
    "dispatchResults": {
      "supplier": {
        "success": true,
        "status": "DISPATCHED",
        "payoutReference": "TXN-20260703-0wzq00a0001-SUPPLIER-1723702621000"
      },
      "retailer": {
        "success": true,
        "status": "DISPATCHED",
        "payoutReference": "TXN-20260703-0wzq00a0001-RETAILER-1723702621500"
      }
    }
  }
}
```

## Manual Trigger (Testing/Debugging)

If the M-Pesa callback doesn't have the complete gatewayPayload or merchantTransactionReference, you can manually trigger the split and payout:

### Endpoint
**POST** `/settlement/split-and-payout/{merchantTransactionReference}`

### Example Request
```bash
curl -X POST http://localhost:3010/settlement/split-and-payout/TXN-20260703-0wzq00a0001 \
  -H "Content-Type: application/json" \
  -d '{
    "mpesaReceipt": "LHD21AS6QV",
    "mpesaCheckoutRequestId": "ws_CO_150820260123302791614036",
    "mpesaMerchantRequestId": "c4f2-4962-b073-3b98b82c4312175950",
    "resultCode": 0,
    "resultDesc": "Manual trigger"
  }'
```

### Example Response
```json
{
  "success": true,
  "message": "Split and payout dispatch initiated",
  "data": {
    "success": true,
    "settlementId": "cmstik677000d1t7uotv33ust",
    "merchantTransactionReference": "TXN-20260703-0wzq00a0001",
    "splitRecord": { ... },
    "dispatchResults": {
      "supplier": { "status": "DISPATCHED", "payoutReference": "..." },
      "retailer": { "status": "DISPATCHED", "payoutReference": "..." }
    }
  }
}
```

## Key Logging References

| Log Prefix | Meaning | Examples |
|-----------|---------|----------|
| `[PAYMENT][CALLBACK]` | Payment callback processing | Received, parsed, updated transaction |
| `[SETTLEMENT][SPLIT]` | Settlement split and allocation | Splitting funds, marking FUNDS_SPLIT status |
| `[B2B][DISPATCH]` | B2B payout dispatch | Sending payout to gateway, recording dispatch |
| `[SETTLEMENT][TEST]` | Manual/test operations | Manual split and payout trigger |

## Settlement Statuses

- **PENDING**: Settlement created, awaiting payment
- **PENDING_PROCESSING**: Payment received, awaiting fund splitting
- **FUNDS_SPLIT**: Funds split between supplier and retailer
- **PROCESSING**: Payouts dispatched to B2B gateway
- **COMPLETED**: All payouts completed
- **FAILED**: Payment or payout failed

## Payout Statuses

- **PENDING_PAYOUT**: Awaiting payout dispatch
- **DISPATCHED**: Payout sent to B2B gateway
- **PAID**: Payout confirmed as paid
- **FAILED**: Payout failed

## Configuration

Ensure the following environment variables are set:

```env
# M-Pesa Configuration
MPESA_ENVIRONMENT=production (or sandbox)
MPESA_CALLBACK_URL=https://yourdomain.com/payments/callbacks/mpesa

# B2B Gateway Configuration (optional)
B2B_GATEWAY_BASE_URL=http://localhost:3010
B2B_GATEWAY_PAYOUT_PATH=/api/payments/mpesa/b2b
PAYMENT_GATEWAY_API_TOKEN=your_token
```

## Troubleshooting

### Payment callback received but no payout dispatched
1. Check that M-Pesa callback payload includes `Body.gatewayPayload.merchantTransactionReference`
2. Manually trigger using the `/settlement/split-and-payout/{merchantTransactionReference}` endpoint
3. Check logs for `[SETTLEMENT][SPLIT]` entries

### Payout dispatch failed
1. Check that supplier/retailer payout destination is configured
2. Verify B2B gateway is accessible and responding
3. Check `[B2B][DISPATCH]` logs for gateway errors
4. Check that payment was marked as successful before dispatch

### Missing payout amounts
1. Verify supplier/retailer amounts are in the settlement payload
2. Check that supplier is found during settlement validation
3. Review `[SETTLEMENT][SPLIT] parsed settlement amounts` logs

