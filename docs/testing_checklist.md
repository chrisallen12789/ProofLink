# ProofLink Onboarding — Testing Checklist

Run through all tests in order. Each test includes:
  - WHAT to test
  - WHERE to run it
  - HOW to confirm it worked

---

## BLOCK 1: SQL Setup Tests

### 1.1 Table exists
  WHERE: Supabase → Table Editor
  HOW: Open Table Editor → confirm "tenant_onboarding_requests" appears in the list

### 1.2 Columns are correct
  WHERE: Supabase → SQL Editor
  RUN:
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'tenant_onboarding_requests'
    ORDER BY ordinal_position;
  CONFIRM: id, status, business_name, business_slug, owner_name, owner_email,
           phone, business_type, city_state, requested_subdomain, logo_url,
           seed_template_key, created_at, updated_at, approved_at, provision_error
           all appear.

### 1.3 Status constraint enforced
  WHERE: Supabase → SQL Editor
  RUN:
    INSERT INTO tenant_onboarding_requests (business_name, owner_name, owner_email, status)
    VALUES ('Test', 'Test User', 'test@test.com', 'invalid_status');
  CONFIRM: Returns a constraint violation error. Row is NOT inserted.

### 1.4 Default status is 'submitted'
  WHERE: Supabase → SQL Editor
  RUN:
    INSERT INTO tenant_onboarding_requests (business_name, owner_name, owner_email)
    VALUES ('Test Biz', 'Test Owner', 'owner@test.com')
    RETURNING id, status;
  CONFIRM: status = 'submitted' in the returned row.

### 1.5 updated_at auto-updates
  WHERE: Supabase → SQL Editor
  RUN: (after 1.4 above)
    UPDATE tenant_onboarding_requests SET business_name = 'Updated Biz'
    WHERE owner_email = 'owner@test.com'
    RETURNING updated_at;
  CONFIRM: updated_at is a recent timestamp (not the original created_at value).

### 1.6 Indexes exist
  WHERE: Supabase → SQL Editor
  RUN:
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'tenant_onboarding_requests';
  CONFIRM: idx_onboarding_requests_status, idx_onboarding_requests_email,
           idx_onboarding_requests_created_at appear.

---

## BLOCK 2: Netlify Function Deployment Tests

### 2.1 Functions deploy without errors
  WHERE: Netlify → Deploys → latest deploy log
  CONFIRM: No "Function bundling failed" errors for the 4 new functions.

### 2.2 submit-onboarding-request — success
  WHERE: Terminal (curl) or Postman
  RUN:
    curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/submit-onboarding-request \
      -H "Content-Type: application/json" \
      -d '{"business_name":"Curl Test Bakery","owner_name":"Jane Smith","owner_email":"jane@test.com","business_type":"bakery"}'
  CONFIRM: HTTP 201, JSON with request_id and status: "submitted"

### 2.3 submit-onboarding-request — missing fields
  WHERE: Terminal
  RUN:
    curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/submit-onboarding-request \
      -H "Content-Type: application/json" \
      -d '{"business_name":"No Email Biz","owner_name":"Bob"}'
  CONFIRM: HTTP 400, JSON with error and fields array mentioning owner_email

### 2.4 list-onboarding-requests — unauthenticated
  WHERE: Terminal
  RUN:
    curl https://YOUR-SITE.netlify.app/.netlify/functions/list-onboarding-requests
  CONFIRM: HTTP 401

### 2.5 list-onboarding-requests — authenticated
  WHERE: Terminal (use a valid operator Bearer token)
  RUN:
    curl https://YOUR-SITE.netlify.app/.netlify/functions/list-onboarding-requests \
      -H "Authorization: Bearer YOUR_TOKEN"
  CONFIRM: HTTP 200, JSON with requests array (may be empty or include test records)

### 2.6 approve-onboarding-request — unauthenticated
  WHERE: Terminal
  RUN:
    curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/approve-onboarding-request \
      -H "Content-Type: application/json" \
      -d '{"id":"some-uuid"}'
  CONFIRM: HTTP 401

### 2.7 provision-tenant — unauthenticated
  WHERE: Terminal
  RUN:
    curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/provision-tenant \
      -H "Content-Type: application/json" \
      -d '{"id":"some-uuid"}'
  CONFIRM: HTTP 401

---

## BLOCK 3: Onboarding Form Tests (Browser)

### 3.1 Landing page loads
  WHERE: Browser → https://YOUR-SITE.netlify.app/
  CONFIRM: ProofLink landing page renders with "Sell. Track. Get Paid." tagline visible.
           "Start Now" button appears in nav.

### 3.2 Landing page links to join page
  WHERE: Browser → https://YOUR-SITE.netlify.app/
  ACTION: Click "Start your free setup →" or "Start Now →" button
  CONFIRM: Browser navigates to /join without errors.

### 3.3 Join page loads
  WHERE: Browser → https://YOUR-SITE.netlify.app/join
  CONFIRM: Multi-step form renders. Step 1 (business type selection) is visible.

### 3.4 Business type selection works
  WHERE: /join → Step 1
  ACTION: Click a business type chip (e.g. "Bakery / Food")
  CONFIRM: Chip highlights (border turns blue, background turns light blue).

### 3.5 Step 1 validation
  WHERE: /join → Step 1
  ACTION: Click "Continue" WITHOUT selecting a type
  CONFIRM: Error message "Please select a business type." appears.

### 3.6 Step 2 — business info
  WHERE: /join → Step 2 (after selecting a type)
  ACTION: Leave business name blank, click Continue
  CONFIRM: "Business name is required." error appears.
  ACTION: Fill in business name and continue
  CONFIRM: Advances to Step 3.

### 3.7 Step 3 — contact info validation
  WHERE: /join → Step 3
  ACTION: Enter invalid email (e.g. "notanemail"), click "Review application"
  CONFIRM: Email validation error appears.
  ACTION: Fill in valid name and email, continue
  CONFIRM: Advances to Step 4 (review).

### 3.8 Review step shows correct data
  WHERE: /join → Step 4
  CONFIRM: Review table shows the values entered in previous steps.

### 3.9 Form submits successfully
  WHERE: /join → Step 4
  ACTION: Click "Submit application"
  CONFIRM: Success screen appears with:
           - "Application submitted!" heading
           - The email address you entered
           - A reference ID (UUID)

### 3.10 Request appears in Supabase
  WHERE: Supabase → Table Editor → tenant_onboarding_requests
  CONFIRM: A new row appears with the business name and email from the form submission.
           status = 'submitted'

---

## BLOCK 4: Provisioning Workflow Tests

### 4.1 Operator provisioning page loads
  WHERE: Browser → https://YOUR-SITE.netlify.app/operator/provisioning.html
  CONFIRM: Login form appears (not a blank page, not a 404).

### 4.2 Login with invalid credentials
  WHERE: /operator/provisioning.html → login form
  ACTION: Enter wrong email/password, click Sign in
  CONFIRM: Error message appears. Does NOT redirect or show the queue.

### 4.3 Login with valid operator credentials
  WHERE: /operator/provisioning.html
  ACTION: Enter valid operator email and password
  CONFIRM: Queue page loads. Onboarding requests table is visible.
           The test submission from Block 3 step 3.9 appears in the table.

### 4.4 Filter tabs work
  WHERE: /operator/provisioning.html (logged in)
  ACTION: Click "Submitted" filter tab
  CONFIRM: Table filters to show only submitted requests.
  ACTION: Click "All" tab
  CONFIRM: All requests return.

### 4.5 Approve a request
  WHERE: /operator/provisioning.html
  ACTION: Find the test submission, click "Approve"
  CONFIRM: Toast notification "Request approved" appears.
           Row status changes to "approved" badge (blue).
           "▶ Provision" button now appears.

### 4.6 Verify approval in Supabase
  WHERE: Supabase → tenant_onboarding_requests table
  CONFIRM: The row status = 'approved', approved_at is set to a recent timestamp.

### 4.7 Run provisioning
  WHERE: /operator/provisioning.html
  ACTION: Click "▶ Provision" on the approved request
  CONFIRM: Button shows "Provisioning…" while running.
           Toast "Tenant X provisioned successfully" appears.
           Row status changes to "provisioned" (green badge).

### 4.8 Verify tenant was created
  WHERE: Supabase → tenants table
  CONFIRM: A new row exists with:
           - name = the business name from the form
           - slug = a URL-safe version of the business name
           - owner_email = email from form
           - onboarding_request_id = UUID of the onboarding request

### 4.9 Verify operator was created
  WHERE: Supabase → operators table
  CONFIRM: A row exists with email matching the form owner_email.

### 4.10 Verify operator_members row
  WHERE: Supabase → operator_members table
  CONFIRM: A row links the new operator to the new tenant with role = 'owner'.

### 4.11 Idempotency test — run provisioning twice
  WHERE: Supabase → SQL Editor
  STEP 1: Reset the test request back to 'approved':
    UPDATE tenant_onboarding_requests
    SET status = 'approved'
    WHERE business_name = 'YOUR TEST BUSINESS NAME';
  STEP 2: In provisioning UI, provision again.
  CONFIRM: Function returns success with message "Tenant already provisioned (idempotent)".
           NO duplicate tenant row is created (check tenants table — still only one row).

### 4.12 Cannot provision un-approved request
  WHERE: Supabase → SQL Editor — insert a 'submitted' request:
    INSERT INTO tenant_onboarding_requests (business_name, owner_name, owner_email)
    VALUES ('Raw Submit Test', 'Test', 'rawtest@test.com');
  Then attempt to call provision-tenant directly with its ID.
  CONFIRM: HTTP 400 with error "must be in approved or failed status".

---

## BLOCK 5: Stripe Connect Compatibility Tests

### 5.1 stripe-connect-link still works
  WHERE: Terminal
  RUN: Call /.netlify/functions/stripe-connect-link with appropriate params
  CONFIRM: Returns expected response (same behavior as before this deployment).

### 5.2 stripe-webhook still works
  WHERE: Netlify → Stripe dashboard → test a webhook event
  CONFIRM: Webhook is received and processed without errors.

### 5.3 tenant-payment-status still works
  WHERE: Terminal or browser
  CONFIRM: Returns expected tenant payment status for an existing tenant.

### 5.4 New provisioning does not interfere with Stripe
  CONFIRM: A provisioned tenant from Block 4 does NOT automatically create a
           Stripe Connect account. That flow remains separate (initiated by
           the business owner after login). No Stripe API calls occur in provision-tenant.js.

---

## BLOCK 6: Tenant Storefront Verification

### 6.1 Existing storefront still loads
  WHERE: Browser → https://YOUR-SITE.netlify.app/ (on tenant domain)
  CONFIRM: Existing storefront (e.g. Honest To Crust) still renders correctly.
           Nothing about the existing tenant experience has changed.

### 6.2 New tenant slug does not collide
  WHERE: Supabase → tenants table
  CONFIRM: The newly provisioned tenant has a unique slug (no duplication).

### 6.3 Operator dashboard still accessible
  WHERE: Browser → https://YOUR-SITE.netlify.app/operator/
  CONFIRM: Existing operator dashboard loads correctly.
           New "Provisioning Queue" nav link is visible.

---

## BLOCK 7: Navigation and Accessibility Tests

### 7.1 All required pages are reachable by URL
  CHECK: GET / → 200
  CHECK: GET /join → 200
  CHECK: GET /operator/ → 200
  CHECK: GET /operator/provisioning.html → 200

### 7.2 Landing page → Join page flow
  WHERE: Browser
  PATH: / → click "Start Now" → /join → fill form → submit
  CONFIRM: Complete flow works end-to-end with no broken links or JS errors.

### 7.3 No 404s on new pages
  WHERE: Browser DevTools → Network tab
  CONFIRM: No 404 responses when loading /, /join, or /operator/provisioning.html

---

## Quick Smoke Test (condensed)

For a fast end-to-end check after deployment:

  1. Visit /               → landing page loads, "Sell. Track. Get Paid." visible
  2. Click "Start Now"     → /join loads
  3. Complete the form     → submit → success screen + reference ID
  4. Visit Supabase        → row in tenant_onboarding_requests, status = submitted
  5. Visit /operator/provisioning.html → log in
  6. Find request → Approve → Provision
  7. Visit Supabase → row in tenants table for the new business
  8. Visit existing storefront → still works normally
