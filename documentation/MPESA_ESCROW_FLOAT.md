# Retailer M-Pesa Escrow Float

## Float configuration API

These administrator-only endpoints require a JWT with the `ADMIN` or `SUPER_ADMIN` role:

- `GET /escrow/retailers/{merchantId}/float`
- `PUT /escrow/retailers/{merchantId}/float`

Example request:

```json
{
  "dailyFloat": 1000
}
```

On first setup, `expectedRemainingBalance` defaults to `dailyFloat`. To explicitly reset the tracked remainder while editing:

```json
{
  "dailyFloat": 1000,
  "expectedRemainingBalance": 800
}
```

Editing only `dailyFloat` leaves the current expected remainder unchanged. Float settings cannot be changed while a transfer is in progress.

## Retailer M-Pesa environment variables

Configure one dedicated `MPESA_RETAILER_*` set in the retailer deployment environment. These variables are used only by the M-Pesa Account Balance API and the retailer-to-PayAssure B2B transfer API. STK, B2C, regular B2B, and all other M-Pesa operations continue to use the existing shared `MPESA_*` variables.

```dotenv
MPESA_RETAILER_ENVIRONMENT=production
MPESA_RETAILER_CONSUMER_KEY=<retailer-consumer-key>
MPESA_RETAILER_CONSUMER_SECRET=<retailer-consumer-secret>
MPESA_RETAILER_SHORTCODE=<retailer-shortcode>
MPESA_RETAILER_PARTY_A=<retailer-party-a>
MPESA_RETAILER_INITIATOR_NAME=<retailer-initiator>
MPESA_RETAILER_INITIATOR_PASSWORD=<retailer-initiator-password>
MPESA_RETAILER_CALLBACK_URL=https://api.example.com/payments
MPESA_RETAILER_PAYASSURE_SHORTCODE=<payassure-receiving-shortcode>
```

`MPESA_RETAILER_PARTY_A` is optional and defaults to `MPESA_RETAILER_SHORTCODE`. The Account Balance and retailer escrow B2B calls use the same `ProductionCertificate .cer` certificate as the existing M-Pesa APIs. `MPESA_RETAILER_CALLBACK_URL` must be publicly reachable; the service appends the escrow callback paths. Do not put real credentials in source control.

Safaricom result callbacks use `/payments/callbacks/mpesa/escrow-balance/{transferId}` and `/payments/callbacks/mpesa/escrow-transfer/{transferId}`. Queue-timeout callbacks use separate `/payments/callbacks/mpesa/escrow-balance-timeout/{transferId}` and `/payments/callbacks/mpesa/escrow-transfer-timeout/{transferId}` paths. A B2B timeout keeps the float locked until a final result arrives because the transfer outcome is unknown.

## Settlement behavior

For live CASH settlements, the engine requests the retailer's Account Balance and waits for Safaricom's callback. It compares the `Working Account` balance with the retailer's stored `expectedRemainingBalance`; higher balances pass, lower balances fail with a tampering/top-up reason. For mixed CASH + MPESA funding, the STK prompt starts only after the balance passes, and the escrow B2B transfer waits for the successful STK callback.

After funding gates pass, B2B transfers only the settlement's CASH amount to the PayAssure shortcode. The expected remainder decreases only after Safaricom's successful B2B callback. Supplier/retailer splitting resumes only after that callback. A failed or mismatched transfer releases the active-transfer lock without reducing the remainder.

Production CASH settlements are blocked unless a float is configured. Development/test settlements without a float continue to use the existing mock escrow flow.
