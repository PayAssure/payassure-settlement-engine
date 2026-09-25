# Equity Bank / Finserve Integration

The `equity-bank` module integrates Finserve's Equity Bank APIs. It uses UAT by default and switches to live URLs when `EQUITY_BANK_ENVIRONMENT=production` or `live`.

## Configuration

```env
EQUITY_BANK_ENVIRONMENT=uat
EQUITY_BANK_API_KEY=your-jenga-api-key
EQUITY_BANK_MERCHANT_CODE=your-merchant-code
EQUITY_BANK_CONSUMER_SECRET=your-consumer-secret
EQUITY_BANK_PRIVATE_KEY_PATH=privatekey.pem
EQUITY_BANK_DEBUG_LOGGING=false
```

The service reads the RSA private key from the PEM file at `EQUITY_BANK_PRIVATE_KEY_PATH`, which defaults to `privatekey.pem` in the project root. The PEM file is excluded from git. Optional URL overrides are available as `EQUITY_BANK_TOKEN_URL`, `EQUITY_BANK_ACCOUNT_BALANCE_URL`, `EQUITY_BANK_INTERNAL_TRANSFER_URL`, `EQUITY_BANK_PESALINK_BANK_URL`, and `EQUITY_BANK_PESALINK_MOBILE_URL`.

Set `EQUITY_BANK_DEBUG_LOGGING=true` temporarily when diagnosing provider failures. Logs include exact request URLs, methods, business payloads, signature input strings, HTTP statuses, and provider responses. API keys, consumer secrets, bearer tokens, signatures, and private keys are never logged; they are represented by fingerprints.

## Endpoints

- `GET /equity-bank/accounts/balances/:countryCode/:accountId`: signs `countryCode+accountId` and returns `status`, `code`, `message`, and `data.balances`/`data.currency`.
- `POST /equity-bank/remittance/internal-bank-transfer`: signs `source.accountNumber+transfer.amount+transfer.currencyCode+transfer.reference`.
- `POST /equity-bank/remittance/pesalink-account`: signs `transfer.amount+transfer.currencyCode+transfer.reference+destination.name+source.accountNumber`.
- `POST /equity-bank/remittance/pesalink-mobile`: uses the same signature formula as the PesaLink account operation.

The request and success response examples for all four operations are available in Swagger at `/api`. Amounts must be strings with two decimal places, references must be unique, and signatures are RSA-SHA256 plus Base64. The service obtains the Finserve bearer token automatically using the configured API key, merchant code, and consumer secret.

Provider errors are surfaced as `503` responses with the original Finserve payload in `details`. The provider's documented error codes are `400 INVALID_REQUEST`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, and `404 ACCOUNT_NOT_FOUND`; callers should also handle `500` provider failures and transaction status code `111102` (reference not found).