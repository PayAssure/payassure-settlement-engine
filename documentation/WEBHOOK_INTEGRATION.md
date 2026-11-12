# PayAssure Webhook Integration

This guide describes the outbound settlement webhooks PayAssure sends to the
retailer integration. Suppliers do not receive settlement webhooks. The retailer
hosts a receiver endpoint, for example `https://pos.example.com/webhook`, and
configures its URL on the retailer integration. There is no separate PayAssure
inbound route named `/webhook`; this is the HTTPS URL on your system that
PayAssure calls.

## 1. Configure the receiver URL

Implement `POST /webhook` on the receiver. Configure the complete absolute
URL, including `/webhook`, for the retailer integration. Both HTTP and HTTPS
URLs are accepted for development; use HTTPS in production because HTTP does
not encrypt the event or signature in transit. A `localhost` URL points to the
machine/container running PayAssure, not necessarily the developer's computer.

Use the authenticated onboarding API to set a participant's fallback URL:

```http
PATCH /onbordings/:participantId/webhook
Authorization: Bearer <user-jwt>
Content-Type: application/json
```

```json
{
  "webhookUrl": "http://localhost:3010/webhook"
}
```

When PayAssure resolves the callback destination, the retailer participant's
`webhookUrl` takes precedence. The integration's `webhookUrl` is used only if
the retailer participant URL is not configured. PayAssure signs events with
the retailer integration's API secret. Before retrying a queued delivery,
PayAssure refreshes its endpoint from these current database settings, so a
corrected participant URL also applies to pending retries.

Generate or retrieve the retailer credentials through the authenticated
`POST /onbordings/generate-keys` and `GET /onbordings/keys` routes. Keep the
retailer's merchant ID and API secret in a secure server-side credential store.
Do not put the API secret in browser/mobile code or expose it in logs.

## 2. Delivery request

PayAssure sends one `POST` to the configured retailer endpoint for an event.
Supplier endpoints are not called. `data.recipient.merchant_id` identifies the
retailer account.

Headers:

| Header | Meaning |
| --- | --- |
| `Content-Type` | `application/json` |
| `x-payassure-event` | Event type, same as the JSON `type`. |
| `x-payassure-event-id` | Event ID, same as JSON `id`; stable for retry attempts of this delivery. |
| `x-payassure-timestamp` | Unix timestamp in seconds used to sign the body. |
| `x-payassure-signature` | `t=<timestamp>,v1=<lowercase-hex-HMAC-SHA256>` |

Example event:

```json
{
  "id": "8b4e1402-20df-4a29-b255-aec5537d7631",
  "type": "payment.settlement.partially_failed",
  "created_at": "2026-11-03T14:40:00.000Z",
  "data": {
    "settlement": {
      "id": "clxsettlement123",
      "reference": "SET-20261103-001",
      "merchant_transaction_reference": "POS-20261103-001",
      "amount": 1000,
      "currency": "KES",
      "status": "FAILED"
    },
    "cash_funding": {
      "amount": 100,
      "currency": "KES",
      "source": "RETAILER_VIRTUAL_BALANCE"
    },
    "details": {
      "party": "SUPPLIER",
      "payout_status": "FAILED",
      "failure_reason": "Destination rejected the transfer",
      "payout_reference": "PAYOUT-001"
    },
    "recipient": {
      "merchant_id": "pay_retailer_001",
      "participant_type": "RETAILER"
    },
    "payouts": [
      {
        "party": "SUPPLIER",
        "merchant_id": "pay_supplier_001",
        "amount": 800,
        "status": "FAILED",
        "reference": "PAYOUT-001",
        "updated_at": "2026-11-03T14:39:59.000Z"
      }
    ]
  }
}
```

`settlement.status` is PayAssure's overall settlement lifecycle status; it is
not the customer collection outcome. Use the `payment.collection.*` event to
determine whether customer funds were collected. Payout attempts are reported
separately in `data.payouts`. The retailer delivery can contain payout attempts
for both retailer and suppliers; no webhook is sent to suppliers.

`data.cash_funding` is included only after a positive cash amount has been
reserved from the retailer's database-backed virtual balance for payout. It
reports the amount used and its source, not the retailer's remaining or
available float balance. It is omitted for settlements with no cash funding
and while a mixed settlement is still waiting for its customer M-Pesa callback.

## 3. Verify the signature

The signed message is the exact raw HTTP request body, without parsing,
reformatting, or re-serializing JSON:

```text
HMAC-SHA256(secret, timestamp + "." + raw_body)
```

The secret is the API secret belonging to
`data.recipient.merchant_id`. Since the body is not trusted before verification,
you may read that field only to select a candidate secret; do not process or act
on the event unless signature verification succeeds. Also require the timestamp
header and the timestamp in the signature header to match, then reject stale or
future timestamps using a small configured replay window (for example, five
minutes).

Example Node.js/TypeScript verification outline:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyPayAssureWebhook(
  rawBody: Buffer,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!timestampHeader || !signatureHeader || !/^\d+$/.test(timestampHeader)) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const separator = part.indexOf('=');
      return [part.slice(0, separator), part.slice(separator + 1)];
    }),
  );
  if (parts.t !== timestampHeader || !/^[a-f0-9]{64}$/i.test(parts.v1 ?? '')) return false;

  const receivedAt = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(receivedAt) || Math.abs(now - receivedAt) > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestampHeader}.${rawBody.toString('utf8')}`)
    .digest();
  const supplied = Buffer.from(parts.v1, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
```

The outline intentionally accepts the raw body and the secret as arguments:

1. Retain the raw request bytes in your HTTP framework before JSON middleware
   consumes them.
2. Parse enough JSON to read `data.recipient.merchant_id`.
3. Look up that merchant's API secret from your secure store.
4. Verify the timestamp and signature against the original raw bytes using a
   constant-time comparison.
5. Only then validate the event schema and perform business processing.

Unknown merchant IDs, malformed JSON, unknown event types, missing headers,
invalid signatures, and stale timestamps should be rejected and logged without
changing payment or settlement records.

## 4. Idempotency and HTTP response

Store processed events durably with a unique constraint on the pair
`(recipient merchant ID, event ID)`. After signature verification, check `id`
(or `x-payassure-event-id`) together with `data.recipient.merchant_id` before
applying any business action. If that pair has already been processed, return a
successful `2xx` response without applying it again. PayAssure keeps the same
event ID for retries.

Return `2xx` only after the event has been durably accepted or queued for
processing. If your service cannot accept it, return a non-2xx response so
PayAssure can retry. Keep the receiver fast and move lengthy downstream work to
your own queue.

## 5. Supported events and when they are sent

| Event | Meaning |
| --- | --- |
| `payment.collection.succeeded` | PayAssure recorded a successful customer payment callback or confirmation. This is the customer-payment outcome; a later payout failure does not reverse it. |
| `payment.collection.failed` | A customer payment callback reported failure before a successful payment was confirmed. |
| `payment.settlement.started` | PayAssure accepted the successful collection for allocation and settlement processing. |
| `payment.settlement.progress` | Settlement processing or payout callback updated the recorded payout state. Check `data.payouts` for the latest available attempt states. |
| `payment.settlement.partially_failed` | A payout callback reported failure. Customer collection status remains separate; the event's `details` identifies the failed party and payout reference. |
| `payment.settlement.retrying` | PayAssure is dispatching a subsequent payout attempt. `details` includes the party, payout reference, and attempt count. |
| `payment.settlement.completed` | The settlement was marked completed, including through reconciliation. |
| `payment.settlement.reconciliation_required` | The settlement entered `AWAITING_RECONCILIATION`. |

The `details` object contains event-specific fields and may be empty for events
without additional details. `data.payouts` is a snapshot of payout attempts
known when the webhook is prepared; it is not a promise that all payout
callbacks have arrived.

## 6. Retry and delivery behavior

For the retailer endpoint, PayAssure makes a synchronous HTTP or HTTPS request with a
five-second request timeout. A transport error or non-2xx response is retried
up to three total attempts with a short backoff, except non-retryable 4xx
responses (such as `404` and `405`), which are logged and stopped immediately.
`408`, `425`, `429`, and 5xx responses remain retryable. Redirects are rejected.
Delivery failures are logged and do not roll back payment or settlement state.

The current sender retries within the request execution only; it does not
persist a webhook outbox or guarantee delivery after a process crash. Your
system must use idempotent event handling and should reconcile important
transactions through the settlement status/history APIs if it does not receive
events. A later, separate notification for a state change has a new event ID.

### Diagnosing delivery failures

| Log result | Likely cause | What to check |
| --- | --- | --- |
| `Webhook returned HTTP 405` | The URL is reachable, but its route does not accept `POST`. | Implement `POST` on the retailer's configured path; check proxy or web-server method rules. PayAssure does not retry this permanent response. |
| `Webhook returned HTTP 404` | The configured path does not exist on the receiver. | Correct the full webhook URL, including its route path, on the retailer integration or participant. PayAssure does not retry this permanent response. |
| `fetch failed` | The receiver could not be reached or its HTTP/TLS connection failed. | Use the logged full retailer URL and nested cause (for example DNS code) to check DNS, network access, TLS certificate/hostname for HTTPS, firewall and server availability from the PayAssure host. |

These are receiver/configuration failures, not settlement payout failures. The
settlement continues independently of webhook delivery. Return a `2xx` only
after accepting the event; then inspect the receiver's request logs using the
event ID and retailer merchant ID if processing did not occur. PayAssure prefers
the retailer participant's `webhookUrl` over the integration-level URL.
Delivery logs include the full outbound request (URL, method, headers, and body)
and HTTP response (status, headers, and body) for each attempt. The request
signature and webhook payload are included, so restrict access to application
logs and avoid forwarding them to untrusted systems.

## 7. Integration checklist

- [ ] Expose a receiver accepting `POST` at `/webhook`.
- [ ] Configure the full receiver URL on the retailer integration or its
      participant fallback. Prefer HTTPS outside development.
- [ ] Store the retailer merchant ID and integration API secret securely.
- [ ] Preserve the raw request body and verify HMAC and timestamp before trusting
      any event fields.
- [ ] Route only after verification, using `data.recipient.merchant_id`.
- [ ] Store `(recipient merchant ID, event ID)` with a uniqueness constraint
      and make state updates idempotent.
- [ ] Keep customer collection state independent from supplier/retailer payout
      and overall settlement state.
- [ ] Return `2xx` after durable acceptance; use reconciliation if delivery is
      missed.

{
  "id": "537cdee2-6fa9-43e4-8ee0-9ab8ff7ef70f",
  "type": "payment.collection.succeeded",
  "created_at": "2026-11-12T08:10:07.000Z",
  "data": {
    "settlement": {
      "id": "cmwd8oqja000jxf00tbla4o9w",
      "reference": "PASTL-20261112074136-636E8432",
      "merchant_transaction_reference": "POS-bf3bfdc7-da75-41f8-92dc-3495d05e8254",
      "merchantTransactionReference": "POS-bf3bfdc7-da75-41f8-92dc-3495d05e8254",
      "amount": 10,
      "currency": "KES",
      "status": "COMPLETED"
    },
    "details": {
      "status": "PAID",
      "collectionStatus": "completed",
      "provider": "CASH",
      "amount": 10,
      "currency": "KES"
    },
    "recipient": {
      "merchant_id": "pay_a540605f5a27dde1",
      "participant_type": "RETAILER"
    },
    "payouts": []
  }
}