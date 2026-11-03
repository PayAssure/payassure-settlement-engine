# PayAssure Webhook Integration

This guide describes the outbound settlement webhooks PayAssure sends to retailer
and supplier integrations. A merchant hosts one receiver endpoint, for example
`https://pos.example.com/webhook`, and configures that same URL for each
merchant integration that should receive events. PayAssure sends the merchant
ID in each event so the receiver can route it internally. There is no separate
PayAssure inbound route named `/webhook`; this is the HTTPS URL on your system
that PayAssure calls.

## 1. Configure the receiver URL

Implement `POST /webhook` on your public HTTPS server. The URL must be absolute
and use HTTPS. Configure the complete URL, including `/webhook`, for each
participant that should receive events.

Use the authenticated onboarding API to set a participant's fallback URL:

```http
PATCH /onbordings/:participantId/webhook
Authorization: Bearer <user-jwt>
Content-Type: application/json
```

```json
{
  "webhookUrl": "https://pos.example.com/webhook"
}
```

When PayAssure resolves the callback destination, an integration-specific
`webhookUrl` takes precedence over the participant URL. If the integration has
no webhook URL, the participant URL is used. Therefore, for a shared endpoint,
set the same URL on every integration that has its own override, or leave that
override unset and configure the participant URL. Use the merchant ID for the
specific integration when associating credentials with your receiver.

Generate or retrieve the merchant credentials through the authenticated
`POST /onbordings/generate-keys` and `GET /onbordings/keys` routes. Keep each
integration's merchant ID and API secret in a secure server-side credential
store, keyed by merchant ID. Do not put an API secret in browser/mobile code,
expose it in logs, or use one merchant's secret to verify another merchant's
event.

## 2. Delivery request

PayAssure sends one `POST` to each configured retailer/supplier endpoint for an
event. A shared receiver can therefore receive separate deliveries for the
retailer and one or more suppliers at the same URL. Identify the destination
account using `data.recipient.merchant_id`; do not infer it from the route,
settlement reference, or event header. The event ID is shared by the separate
recipient deliveries created for the same settlement notification; the
recipient merchant ID distinguishes them.

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
    "details": {
      "party": "SUPPLIER",
      "payout_status": "FAILED",
      "failure_reason": "Destination rejected the transfer",
      "payout_reference": "PAYOUT-001"
    },
    "recipient": {
      "merchant_id": "pay_supplier_001",
      "participant_type": "SUPPLIER"
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
separately in `data.payouts`. Supplier deliveries contain only that supplier's
payout attempts; retailer deliveries can contain all payout attempts for that
settlement. Payout records currently describe retailer and supplier payouts.

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
`(recipient merchant ID, event ID)`. Do not deduplicate on event ID alone:
separate merchants can receive the same event ID for the same settlement
notification at a shared receiver. After signature verification, check `id`
(or `x-payassure-event-id`) together with `data.recipient.merchant_id` before
applying any business action. If that pair has already been processed, return a
successful `2xx` response without applying it again. This is especially
important for retries: PayAssure keeps the same event ID for retries of that
recipient's delivery.

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

For each configured endpoint, PayAssure makes a synchronous HTTPS request with
a five-second request timeout. A transport error or non-2xx response is retried
up to three total attempts with a short backoff. Redirects are rejected.
Delivery failures are logged and do not roll back payment or settlement state.

The current sender retries within the request execution only; it does not
persist a webhook outbox or guarantee delivery after a process crash. Your
system must use idempotent event handling and should reconcile important
transactions through the settlement status/history APIs if it does not receive
events. A later, separate notification for a state change has a new event ID.

## 7. Integration checklist

- [ ] Expose one public HTTPS receiver at `/webhook`.
- [ ] Configure the full receiver URL for every retailer/supplier integration
      that needs events; use the same URL if all accounts share the receiver.
- [ ] Store each merchant ID and its integration API secret securely.
- [ ] Preserve the raw request body and verify HMAC and timestamp before trusting
      any event fields.
- [ ] Route only after verification, using `data.recipient.merchant_id`.
- [ ] Store `(recipient merchant ID, event ID)` with a uniqueness constraint
      and make state updates idempotent.
- [ ] Keep customer collection state independent from supplier/retailer payout
      and overall settlement state.
- [ ] Return `2xx` after durable acceptance; use reconciliation if delivery is
      missed.
