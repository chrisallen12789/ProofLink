# ProofLink Netlify Functions API

This document summarizes the HTTP-facing files under `netlify/functions` as they are currently implemented.

Base path:
- `/.netlify/functions/<function-name>`

Notes:
- Payload examples below use JSON unless the handler explicitly accepts form-encoded data too.
- Several handlers also answer `OPTIONS` for CORS preflight.
- Authentication requirements describe what the code currently enforces, not what the UI intends.
- `_prooflink_payments.js` is an internal shared module, not a public endpoint.

## `admin-approve-onboarding`
- Endpoint: `/.netlify/functions/admin-approve-onboarding`
- Method: `POST`
- Expected payload: `{ "id": "<onboarding_request_uuid>" }`
- Response format:
  - `201 { "message": "...", "tenant_id": "...", "slug": "...", "operator_id": "...", "login_url": "..." }`
  - `200 { "message": "Tenant already provisioned (idempotent)", "tenant_id": "...", "slug": "...", "login_url": "..." }`
  - Errors: `400`, `401`, `404`, `500`
- Authentication requirements: admin context required via `requireAdminContext`

## `admin-get-onboarding-requests`
- Endpoint: `/.netlify/functions/admin-get-onboarding-requests`
- Method: `GET`
- Expected payload: query params only
  - `id=<uuid>`
  - `status=submitted|approved|provisioning|provisioned|failed|rejected|needs_review`
  - `q=<search>`
  - `limit=<n>`
  - `offset=<n>`
- Response format:
  - Single request: `200 { "request": { ... } }`
  - List: `200 { "requests": [ ... ], "count": 0, "limit": 50, "offset": 0 }`
  - Errors: `401`, `404`, `500`
- Authentication requirements: admin context required via `requireAdminContext`

## `admin-reject-onboarding`
- Endpoint: `/.netlify/functions/admin-reject-onboarding`
- Method: `POST`
- Expected payload: `{ "id": "<onboarding_request_uuid>", "rejection_reason": "optional" }`
- Response format:
  - `200 { "success": true, "id": "...", "rejection_reason": "..." }`
  - Errors: `400`, `401`, `404`, `409`, `500`
- Authentication requirements: admin context required via `requireAdminContext`

## `admin-set-tester-exempt`
- Endpoint: `/.netlify/functions/admin-set-tester-exempt`
- Method: `GET`, `POST`
- Expected payload:
  - `GET ?tenantId=<tenant_uuid>`
  - `POST { "tenantId": "<tenant_uuid>", "exempt": true, "months": 3 }`
- Response format:
  - `GET 200 { "tenantId": "...", "slug": "...", "name": "...", "billingStatus": "...", "billingExempt": true, "billingExemptUntil": "...", "exemptionActive": true, "daysRemaining": 30 }`
  - `POST 201 { "ok": true, "action": "granted", ... }`
  - `POST 200 { "ok": true, "action": "revoked", ... }`
  - Slot conflict: `409 { "error": "...", "activeTesters": [ ... ] }`
  - Errors: `400`, `401`, `404`, `500`
- Authentication requirements: admin context required via `requireAdminContext`

## `admin-update-tenant-conduct`
- Endpoint: `/.netlify/functions/admin-update-tenant-conduct`
- Method: `POST`
- Expected payload: `{ "tenant_id": "<tenant_uuid>", "action": "flag|suspend|reinstate|terminate", "reason_code": "optional", "admin_notes": "optional" }`
- Response format:
  - `200 { "ok": true, "status": "flagged|suspended|active|terminated" }`
  - Errors: `400`, `401`, `403`, `500`
- Authentication requirements: bearer token required; handler verifies Supabase user and currently requires `profiles.role === "admin"`

## `admin-verify`
- Endpoint: `/.netlify/functions/admin-verify`
- Method: `GET`
- Expected payload: none
- Response format:
  - `200 { "email": "...", "name": "...", "role": "admin|platform_admin" }`
  - Errors: `401`, `403`, `500`
- Authentication requirements: bearer token required; handler verifies Supabase auth user and admin role

## `approve-onboarding-request`
- Endpoint: `/.netlify/functions/approve-onboarding-request`
- Method: `POST`
- Expected payload: `{ "id": "<onboarding_request_uuid>" }`
- Response format:
  - `200 { "message": "...", "request": { ...updated request... } }`
  - Errors: `400`, `401`, `404`, `500`
- Authentication requirements: operator context required via `requireOperatorContext`

## `blog-comment`
- Endpoint: `/.netlify/functions/blog-comment`
- Method: `POST`
- Expected payload: `{ "article_slug": "post-slug", "name": "Jane", "email": "jane@example.com", "comment": "At least 10 characters", "notify_subscribe": true, "fax": "", "website": "" }`
- Response format:
  - Honeypot hit: `200 { "ok": true }`
  - Success: `201 { "ok": true, "message": "Comment submitted. Thank you!" }`
  - Errors: `400`, `405`, `429`, `500`
- Authentication requirements: none; public endpoint with IP rate limiting

## `blog-subscribe`
- Endpoint: `/.netlify/functions/blog-subscribe`
- Method: `POST`
- Expected payload: `{ "name": "Jane", "email": "jane@example.com", "source": "blog", "fax": "", "website": "" }`
- Response format:
  - Honeypot hit: `200 { "ok": true }`
  - Success: `201 { "ok": true, "message": "You're subscribed. We'll be in touch." }`
  - Errors: `400`, `405`, `429`, `500`
- Authentication requirements: none; public endpoint with IP rate limiting

## `check-slug`
- Endpoint: `/.netlify/functions/check-slug`
- Method: `GET`
- Expected payload: query param `slug=<requested-slug>`
- Response format:
  - `200 { "available": true, "slug": "..." }`
  - `200 { "available": false, "reason": "reserved|invalid_format|taken|pending", "slug": "..." }`
  - Validation error: `400 { "error": "...", "available": false }`
  - Errors: `405`, `429`
- Authentication requirements: none; public endpoint with IP rate limiting

## `commit-tenant-asset`
- Endpoint: `/.netlify/functions/commit-tenant-asset`
- Method: `POST`
- Expected payload: `{ "receipt": "<signed upload receipt from upload-tenant-asset>" }`
- Response format:
  - `200 { "ok": true, "bucket": "...", "objectPath": "...", "bytes": 123, "slot": "...", "folder": "...", "committed_at": "..." }`
  - Errors: `400`, `401`, `403`, `409`, `500`
- Authentication requirements: operator context required via `requireOperatorContext`

## `contact`
- Endpoint: `/.netlify/functions/contact`
- Method: `POST`
- Expected payload:
  - JSON or `application/x-www-form-urlencoded`
  - Typical fields: `{ "name": "...", "email": "...", "subject": "...", "message": "...", "turnstileToken": "...", "startedAt": 1234567890, "fax": "", "website": "" }`
- Response format:
  - Success: `200 { "ok": true }`
  - Errors: `400`, `405`, `500` with `{ "ok": false, "error": "..." }`
- Authentication requirements: none; public contact form endpoint

## `create-billing-portal-session`
- Endpoint: `/.netlify/functions/create-billing-portal-session`
- Method: `POST`
- Expected payload: `{ "customerId": "<stripe_customer_id>" }`
- Response format:
  - `200 { "ok": true, "url": "https://billing.stripe.com/..." }`
  - Errors: `400`, `405`, `500`
- Authentication requirements: none enforced in the handler

## `create-billing-upgrade-session`
- Endpoint: `/.netlify/functions/create-billing-upgrade-session`
- Method: `POST`
- Expected payload: `{ "tenantId": "<tenant_uuid>", "targetPlan": "growth|enterprise", "featureKey": "optional", "customerEmail": "optional@example.com" }`
- Response format:
  - `200 { "ok": true, "url": "...", "sessionId": "...", "targetPlan": "growth" }`
  - Errors: `400`, `405`, `500`
- Authentication requirements: none enforced in the handler

## `create-tenant-bundle`
- Endpoint: `/.netlify/functions/create-tenant-bundle`
- Method: `POST`
- Expected payload: accepts camelCase or snake_case
  - Required: `business_name`, `owner_name`, `email`, `phone`, `business_category`
  - Optional: `selected_plan`, `fulfillment_model`, `service_area`, `brand_color`, `logo_url`, `subdomain_preference`, `platform_name`, `user_id`, `notes`
- Response format:
  - `200 { "ok": true, "result": { ... } }`
  - Errors: `400`, `405`, `500`
- Authentication requirements: operator context required via `_prooflink_payments.requireOperatorContext`

## `evaluate-onboarding`
- Endpoint: `/.netlify/functions/evaluate-onboarding`
- Method: `POST`
- Expected payload: `{ "request_id": "<onboarding_request_uuid>" }`
- Response format:
  - Returns a rule-evaluation result including `status`, `risk_level`, and `reason_codes`
  - Typical statuses: `approved`, `needs_review`, `rejected`
  - Errors are JSON with HTTP status codes from validation or evaluation failures
- Authentication requirements: internal/admin-style endpoint; implementation relies on service-role environment and optional internal secret logic rather than user auth

## `get-launch-checklist`
- Endpoint: `/.netlify/functions/get-launch-checklist`
- Method: `GET`
- Expected payload: query params `tenant_id=<uuid>` or `slug=<tenant-slug>`
- Response format:
  - `200 { "tenant_id": "...", "tenant_name": "...", "tenant_slug": "...", "steps": [ ... ], "completed": 4, "total": 8, "percent": 50, "launch_ready": false }`
  - Errors: `400`, `404`, `405`
- Authentication requirements: none enforced in the handler

## `get-operator-setup`
- Endpoint: `/.netlify/functions/get-operator-setup`
- Method: `GET`
- Expected payload: none
- Response format:
  - `200 { "tenant": { ... }, "locked_record": { ... }, "editable_fields": [ ... ], "protected_fields": [ ... ], "config": { ... } }`
  - Errors: `401`, `403`, `404`, `500`
- Authentication requirements: operator context required via `requireOperatorContext`

## `get-platform-stats`
- Endpoint: `/.netlify/functions/get-platform-stats`
- Method: `GET`
- Expected payload: none
- Response format:
  - `200 { "tenants": { ... }, "onboarding": { ... }, "orders": { ... }, "recent": { ... }, "governance": { ... } }`
  - Exact sections are dashboard-oriented aggregate metrics
  - Errors: `401`, `405`, `500`
- Authentication requirements: admin context required via `requireAdminContext`

## `get-tenant-limit-health`
- Endpoint: `/.netlify/functions/get-tenant-limit-health`
- Method: `GET`
- Expected payload: optional query params `tenant_id=<uuid>` or `tenantId=<uuid>`; defaults to the operator tenant
- Response format:
  - `200 { "ok": true, "tenant_id": "...", "health": { ...plan and usage health... }, "generated_at": "..." }`
  - Errors: `400`, `403`, `404`, `405`, `500`
- Authentication requirements: operator context required via `requireOperatorContext`

## `get-tenants`
- Endpoint: `/.netlify/functions/get-tenants`
- Method: `GET`
- Expected payload: query params such as `limit`, `offset`, `status`, `q`, `city`, `email`, `slug`
- Response format:
  - `200 { "tenants": [ ... ], "total": 0, "limit": 50, "offset": 0 }`
  - Errors: `401`, `405`, `500`
- Authentication requirements: admin context required via `requireAdminContext`

## `link-operator-user`
- Endpoint: `/.netlify/functions/link-operator-user`
- Method: `POST`
- Expected payload: none
- Response format:
  - `200 { "linked": true, "operator_id": "...", "bootstrapped": true }`
  - Errors: `401`, `404`, `405`, `500`
- Authentication requirements: bearer token required; links current Supabase auth user to an operator record

## `list-onboarding-requests`
- Endpoint: `/.netlify/functions/list-onboarding-requests`
- Method: `GET`
- Expected payload: optional query params `status=<status>` or `id=<uuid>`
- Response format:
  - `200 { "request": { ... } }` for a single record
  - `200 { "requests": [ ... ], "count": 0 }` for a list
  - Errors: `401`, `404`, `405`, `500`
- Authentication requirements: operator context required via `requireOperatorContext`

## `onboarding`
- Endpoint: `/.netlify/functions/onboarding`
- Method: `POST`
- Expected payload: `{ "businessName": "...", "ownerName": "...", "email": "...", "phone": "...", "businessCategory": "...", "selectedPlan": "optional", "fulfillmentModel": "optional", "serviceArea": "optional", "brandColor": "optional", "logoUrl": "optional", "subdomainPreference": "optional", "domainPreference": "optional", "notes": "optional", "startedAt": 1234567890, "website": "" }`
- Response format:
  - `200 { "ok": true, "staged": true, "stage": "..." }`
  - Errors: `400`, `405`, `429`, `500` with `{ "ok": false, "error": "..." }`
- Authentication requirements: none; public onboarding capture endpoint with anti-spam/rate limiting

## `order`
- Endpoint: `/.netlify/functions/order`
- Method: `POST`
- Expected payload: `{ "tenantId": "...", "tenantSlug": "...", "tenantBusinessName": "...", "customer_name": "...", "email": "...", "phone": "...", "fulfillment": "...", "requestedDate": "optional", "requestedTime": "optional", "cartSummary": "optional", "notes": "optional", "items": [ ... ], "turnstileToken": "...", "startedAt": 1234567890, "fax": "", "website": "" }`
- Response format:
  - `200 { "ok": true, "orderId": "..." }`
  - Errors: `400`, `405`, `500` with `{ "ok": false, "error": "..." }`
- Authentication requirements: none; public storefront order endpoint

## `platform-abuse-monitor`
- Endpoint: `/.netlify/functions/platform-abuse-monitor`
- Method: `GET`, `POST`
- Expected payload:
  - `GET`: none; intended for scheduled execution
  - `POST`: none required; may include bearer token for manual admin trigger validation
- Response format:
  - `200 { "ok": true, "scanned": 0, "flagged": 0, "details": [ ... ], "checked_at": "..." }`
  - Errors: `401`, `500`
- Authentication requirements:
  - `GET`: no user auth enforced
  - `POST`: if an authorization header is supplied, the token is validated; otherwise the handler still relies on service-role environment access

## `provision-tenant`
- Endpoint: `/.netlify/functions/provision-tenant`
- Method: `POST`
- Expected payload: `{ "id": "<approved_onboarding_request_uuid>" }`
- Response format:
  - `201 { "message": "...", "tenant_id": "...", "slug": "...", "operator_id": "..." }`
  - `200 { "message": "...idempotent...", "tenant_id": "...", "slug": "..." }`
  - Errors: `400`, `401`, `404`, `500`
- Authentication requirements: operator context required via `requireOperatorContext`

## `reject-onboarding-request`
- Endpoint: `/.netlify/functions/reject-onboarding-request`
- Method: `POST`
- Expected payload: `{ "id": "<onboarding_request_uuid>", "rejection_reason": "optional" }`
- Response format:
  - `200 { "success": true, "id": "..." }`
  - Errors: `400`, `401`, `404`, `409`, `500`
- Authentication requirements: operator context required via `requireOperatorContext`

## `stripe-billing-webhook`
- Endpoint: `/.netlify/functions/stripe-billing-webhook`
- Method: `POST`
- Expected payload: raw Stripe webhook body plus `stripe-signature` header
- Response format:
  - `200 { "ok": true, "received": true }`
  - Signature/config errors: `400 { "ok": false, "error": "..." }`
- Authentication requirements: no bearer auth; Stripe signature verification required

## `stripe-connect-link`
- Endpoint: `/.netlify/functions/stripe-connect-link`
- Method: `POST`
- Expected payload: `{ "tenantId": "<tenant_uuid>", "stripeAccountId": "optional existing acct_...", "country": "US", "email": "optional", "refreshUrl": "optional", "returnUrl": "optional" }`
- Response format:
  - `200 { "ok": true, "url": "https://connect.stripe.com/...", "accountId": "acct_...", "connectStatus": "connect_incomplete" }`
  - Errors: `400`, `401`, `403`, `500`
- Authentication requirements: operator context required for the target tenant

## `stripe-order-checkout`
- Endpoint: `/.netlify/functions/stripe-order-checkout`
- Method: `POST`
- Expected payload: `{ "tenantId": "<tenant_uuid>", "orderId": "<order_uuid>", "stripeAccountId": "optional", "applicationFeeBps": 0, "currency": "usd", "successUrl": "optional", "cancelUrl": "optional", "customerEmail": "optional", "productName": "optional" }`
- Response format:
  - `200 { "ok": true, "url": "https://checkout.stripe.com/...", "id": "cs_...", "amount": 1000, "applicationFee": 0 }`
  - Errors: `400`, `401`, `403`, `404`, `429`, `500`
- Authentication requirements: operator context required for the target tenant; IP rate limited

## `stripe-platform-checkout`
- Endpoint: `/.netlify/functions/stripe-platform-checkout`
- Method: `POST`
- Expected payload: `{ "tenantId": "<tenant_uuid>", "planKey": "starter|growth", "successUrl": "optional", "cancelUrl": "optional" }`
- Response format:
  - `200 { "ok": true, "url": "https://checkout.stripe.com/...", "id": "cs_...", "customer": "cus_..." }`
  - Errors: `400`, `401`, `403`, `500`
- Authentication requirements: operator context required for the target tenant

## `stripe-webhook`
- Endpoint: `/.netlify/functions/stripe-webhook`
- Method: `POST`
- Expected payload: raw Stripe webhook body plus `stripe-signature` header
- Response format:
  - `200 { "ok": true }`
  - Signature/config errors: `400 { "ok": false, "error": "..." }`
  - Processing errors: `500 { "ok": false, "error": "..." }`
- Authentication requirements: no bearer auth; Stripe signature verification required against configured webhook secrets

## `submit-onboarding-request`
- Endpoint: `/.netlify/functions/submit-onboarding-request`
- Method: `POST`
- Expected payload: `{ "business_name": "...", "owner_name": "...", "owner_email": "...", "phone": "optional", "business_type": "optional", "city_state": "optional", "requested_subdomain": "optional", "logo_url": "optional", "seed_template_key": "optional" }`
- Response format:
  - `201 { "message": "Onboarding request submitted successfully", "request_id": "...", "business": "...", "status": "submitted" }`
  - Errors: `400`, `405`, `429`, `500`
- Authentication requirements: none; public endpoint with IP rate limiting

## `supabase-order-proxy`
- Endpoint: `/.netlify/functions/supabase-order-proxy`
- Method: `POST`
- Expected payload: storefront order payload
  - Required: `tenant_id`, `tenant_slug`, `customer_name`, `email`, `phone`, `fulfillment`, `items[]`
  - Also accepts `tenantBusinessName`, `scheduled_date`, `scheduled_time`, `subtotal_cents`, `total_cents`, `notes`, `cart_summary`, `estimated_total_cents`
- Response format:
  - `200 { "ok": true, "orderId": "...", "result": { ...rpc result... } }`
  - Errors: `400`, `405`, `500`
- Authentication requirements: none; service-role backed server proxy to the `submit_storefront_order` RPC

## `tenant-payment-status`
- Endpoint: `/.netlify/functions/tenant-payment-status`
- Method: `GET`, `POST`
- Expected payload:
  - `GET ?tenantId=<tenant_uuid>` or `?tenant_id=<tenant_uuid>`
  - `POST { "tenantId": "<tenant_uuid>" }`
- Response format:
  - `200 { "ok": true, "tenantId": "...", "tenantSlug": "...", "paymentState": { ... }, "raw": { ...tenant billing/connect fields... } }`
  - Errors: `401`, `403`, `404`, `405`, `500`
- Authentication requirements: operator context required for the resolved tenant

## `update-tenant-config`
- Endpoint: `/.netlify/functions/update-tenant-config`
- Method: `POST`
- Expected payload: `{ "tenant_id": "<tenant_uuid>", "config": { "tagline": "...", "hero_heading": "...", "show_prices": true, "allow_custom_requests": false, ... } }`
- Response format:
  - `200 { "success": true, "tenant_id": "...", "protected_fields_rejected": [], "config": { ...merged site settings... } }`
  - Errors: `400`, `401`, `403`, `404`, `405`, `500`
- Authentication requirements: operator context required; tenant must match the authenticated operator tenant

## `upload-tenant-asset`
- Endpoint: `/.netlify/functions/upload-tenant-asset`
- Method: `POST`
- Expected payload: `{ "tenant_id": "<tenant_uuid>", "filename": "logo.png", "content_type": "image/png", "bytes": 12345, "folder": "uploads", "slot": "optional" }`
- Response format:
  - `200 { "ok": true, "bucket": "...", "objectPath": "...", "receipt": "...", "contentType": "image/png", "storageCheck": { ... } }`
  - Storage limit exceeded: `409 { "ok": false, "code": "storage_limit_reached", "error": "...", "check": { ... } }`
  - Errors: `400`, `401`, `403`, `405`, `500`
- Authentication requirements: operator context required; cross-tenant access is rejected unless role/context permits it

## `_prooflink_payments`
- Endpoint: none
- Method: not an HTTP function contract
- Expected payload: n/a
- Response format: n/a
- Authentication requirements: n/a
