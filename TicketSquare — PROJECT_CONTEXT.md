# TicketSquare — Project Context

## 1. Product Overview

**TicketSquare** is an event ticketing platform being built initially for a real event organized by one of the founders/business partners.

The public brand/domain is:

**TicketSquare.ng**

The immediate goal is not to reproduce Tix, Ticketmaster, or another large ticketing platform.

The first goal is:

> Build a ticketing system reliable enough for us to confidently use for our own event instead of using an external ticketing provider.

If the first event goes well, TicketSquare should be capable of evolving into a reusable ticketing platform for other organizers.

The first version should therefore be:

- Small enough to build and test quickly
- Reliable enough for real customers and real money
- Designed cleanly enough to expand later
- Focused on the requirements of the first event
- Free from unnecessary features that do not contribute to running that event successfully

The system should prioritize:

1. Successful ticket purchases
2. Correct payment handling
3. Reliable ticket issuance
4. Reliable QR validation and check-in
5. Useful organizer visibility
6. Good event-day operations
7. Recoverability when something goes wrong

---

# 2. Core V1 Lifecycle

The main V1 flow is:

```text
Create event
↓
Create ticket types
↓
Publish event
↓
Customer visits event page
↓
Customer selects tickets
↓
Customer enters details
↓
Customer pays through Paystack
↓
Paystack confirms payment
↓
Order is marked paid
↓
Ticket(s) are issued
↓
Customer receives ticket access
↓
Customer can view/download/print ticket
↓
Customer arrives at event
↓
Staff scans QR code
↓
Ticket is validated
↓
Ticket is checked in
↓
Organizer can see attendance and sales data
```

Anything that does not meaningfully support this flow should be treated as secondary for V1.

---

# 3. Primary Users

## 3.1 Attendee

An attendee is a person purchasing or receiving a ticket.

They should be able to:

- View an event
- View available ticket types
- Select ticket quantities
- Enter required buyer/attendee details
- Apply a promo code where applicable
- Pay through Paystack
- Receive confirmation
- Access their tickets later
- View tickets on a phone
- Download or print tickets
- Present the QR code at the venue

Attendees should not be forced to create an account for V1 unless there is a compelling implementation reason.

---

## 3.2 Organizer

For the first event, the organizer is our own team.

The organizer should be able to:

- Create and edit the event
- Publish/unpublish the event
- Create ticket categories
- Set ticket prices
- Set inventory limits
- Control sale dates
- View orders
- View attendees
- View ticket sales
- View revenue
- View remaining inventory
- View check-ins
- Manage promo codes
- Track promoter sales
- Cancel/refund tickets where necessary
- Export attendee, sales, and check-in data

---

## 3.3 Event Staff

Event staff operate the entrance.

They need a simple mobile-friendly interface to:

- Scan ticket QR codes
- See ticket validity immediately
- See whether a ticket has already been used
- See relevant attendee/ticket information
- Search attendees manually
- Check attendees in manually
- Work alongside multiple other scanners

V1 does not require a complex organization/staff permission system.

A simple authorization mechanism for trusted staff is sufficient initially.

---

## 3.4 Promoter

Promoters may be used to drive ticket sales.

Each promoter should be identifiable through a unique:

- Referral link
- Referral code

TicketSquare should be able to attribute resulting orders and revenue to the correct promoter.

---

# 4. V1 Functional Scope

## 4.1 Public Event Page

Each published event should have a public, shareable page.

Example:

```text
ticketsquare.ng/events/summer-fest-2026
```

The event page should include:

- Event name
- Event artwork/banner
- Description
- Date
- Start time
- Venue
- Location
- Ticket categories
- Ticket prices
- Ticket availability
- Purchase action

The page should be mobile-first.

A large percentage of traffic is expected to come from:

- WhatsApp
- Instagram
- X
- Direct shared links

The page should therefore:

- Load quickly
- Work well on small screens
- Have clear ticket options
- Avoid unnecessary navigation friction

---

# 4.2 Ticket Types

An event may contain multiple ticket categories.

Examples:

- Early Bird
- Regular
- VIP
- Table
- Group
- Complimentary

Each ticket type should support fields such as:

```text
name
description
price
currency
total quantity
sale start
sale end
minimum purchase quantity
maximum purchase quantity
active/inactive status
```

The system should be able to derive or track:

```text
quantity sold
quantity reserved
quantity remaining
```

Ticket inventory must not oversell.

Inventory operations must be concurrency-safe.

If multiple customers attempt to buy the final available ticket at nearly the same time, the system must preserve inventory correctness.

---

# 4.3 Orders

A customer purchase should create an `Order`.

An order may contain one or more ticket types.

Example:

```text
Order
├── 2 × Regular
└── 1 × VIP
```

Orders should have explicit states.

Possible initial states:

```text
PENDING
PAID
FAILED
CANCELLED
REFUNDED
PARTIALLY_REFUNDED
```

A `PENDING` order must not be treated as completed revenue.

Tickets should not become valid until payment has been authoritatively confirmed.

---

# 4.4 Order Items

An order should contain individual order items representing ticket type selections.

Each `OrderItem` should preserve the commercial details used at purchase time.

For example:

```text
ticket_type_id
ticket_type_name_snapshot
unit_price
quantity
subtotal
```

Do not rely entirely on the current `TicketType` record for historical order pricing, since ticket prices or names may change later.

---

# 4.5 Paystack Payments

**Paystack is the payment provider for V1.**

Do not implement direct card processing.

TicketSquare should initialize payments through Paystack and rely on Paystack for the payment methods supported by their checkout.

The expected flow is:

```text
Create pending order
↓
Calculate authoritative amount on server
↓
Initialize Paystack transaction
↓
Customer completes payment
↓
Paystack sends webhook
↓
TicketSquare verifies authenticity/payment
↓
Order becomes PAID
↓
Ticket(s) are issued
```

## Critical payment rule

The browser redirect after checkout must **not** be treated as authoritative proof of payment.

The backend must verify payment.

Use:

- Paystack webhook signature verification
- Server-side Paystack transaction verification where appropriate

Payment processing must be resilient to:

- Duplicate webhooks
- Delayed webhooks
- Webhooks arriving before browser redirects
- Redirects arriving before webhooks
- User closing the browser after paying
- Temporary network failures
- Retries from Paystack
- Retries from our own application

Payment confirmation must be **idempotent**.

Processing the same successful payment more than once must not:

- Issue duplicate tickets
- Double-count revenue
- Double-decrement inventory
- Create duplicate payments
- Create duplicate orders

The backend must also verify that:

- The provider reference matches the expected order
- The amount matches the expected server-calculated amount
- The currency matches
- The payment was genuinely successful

---

# 4.6 Money Handling

Never use floating-point values for money.

Store monetary amounts as integer minor units.

Example:

```text
₦12,500.00
```

should be stored as:

```text
1250000
```

kobo.

Always associate amounts with a currency.

Example:

```text
amount = 1250000
currency = "NGN"
```

The server is authoritative for:

- Ticket prices
- Discounts
- Fees
- Order totals
- Refund amounts

Never trust totals submitted by the client.

---

# 4.7 Ticket Generation

A successfully paid order should result in ticket records.

Each admission should normally have its own individual `Ticket`.

Example:

A customer buys:

```text
3 × Regular
```

The system creates:

```text
Ticket A
Ticket B
Ticket C
```

Each ticket should contain data such as:

```text
ticket id
public ticket reference
event
ticket type
order
attendee information
status
QR credential
created timestamp
check-in status
```

Possible ticket states:

```text
VALID
CHECKED_IN
CANCELLED
REFUNDED
```

Avoid representing the same state redundantly in multiple fields where possible.

Prefer a clear state model.

---

# 4.8 Attendee Information

Buyer information and attendee information should be modeled carefully.

A purchaser may buy multiple tickets.

Those tickets may:

- Belong to the purchaser
- Belong to different attendees
- Initially have no named attendee

Do not unnecessarily assume:

```text
one order = one attendee
```

The initial data model should leave room for one order containing multiple admissions.

---

# 4.9 QR Credentials

Every admission must have a unique QR credential.

Do not encode predictable database IDs directly into QR codes.

Avoid QR values such as:

```text
ticket/1
ticket/2
ticket/3
```

Use a secure opaque identifier, such as:

- Cryptographically secure random token
- Appropriate UUID
- Signed opaque token

A QR code should identify or resolve to the server-side ticket record.

The server remains authoritative for the current validity of the ticket.

The QR itself should not be treated as proof that the ticket is valid.

---

# 4.10 Digital Tickets

Customers should be able to access a mobile-friendly digital ticket.

The ticket should include:

- TicketSquare branding
- Event name
- Event date
- Venue
- Ticket type
- Attendee name where applicable
- Public ticket reference
- QR code

The digital ticket should be usable directly from a phone screen.

---

# 4.11 Printable Tickets

Customers should have a clear:

**Download / Print Ticket**

option.

A printable ticket may be delivered as:

- A PDF
- A print-optimized webpage

The printed version should contain:

- TicketSquare branding
- Event name
- Event date
- Venue
- Ticket category
- Attendee name where applicable
- Ticket reference
- QR code

## Important rule

Printing a ticket must **not** create another admission.

The digital ticket and printed ticket are two representations of the same underlying ticket.

They must resolve to the same ticket credential.

If the digital version has already been checked in, the printed version must return:

```text
ALREADY_CHECKED_IN
```

and vice versa.

---

# 4.12 Ticket Retrieval

Customers should not depend entirely on the original confirmation email.

Provide a mechanism to retrieve purchased tickets.

Possible V1 approaches include:

```text
secure access link
```

or:

```text
email + order reference
```

The ticket retrieval mechanism should not expose tickets through predictable public URLs.

Any lookup flow involving personally identifying information should be appropriately rate-limited and designed to avoid exposing another customer's ticket.

---

# 4.13 Email Delivery

After confirmed payment, the customer should receive an email containing:

- Order confirmation
- Relevant ticket information
- Secure ticket-access link

Email can be the initial delivery channel.

WhatsApp may be added later.

Email sending must be treated as a side effect of the confirmed purchase, not part of the payment transaction itself.

An email provider failure must not:

- Roll back a successful payment
- Invalidate tickets
- Lose the order

Customers should still be able to retrieve their tickets.

---

# 4.14 QR Scanning

Event staff should have a browser-based scanner that works on mobile phones.

The scanner should use the device camera.

Possible validation states:

```text
VALID
ALREADY_CHECKED_IN
INVALID
CANCELLED
REFUNDED
WRONG_EVENT
```

A successful scan should show enough information for staff to make a quick decision.

Example:

```text
VIP
John Doe
VALID
```

The UX should prioritize speed and clarity.

---

# 4.15 Atomic Check-In

Check-in must be concurrency-safe.

Scenario:

Two entrance staff scan the same ticket at nearly the same time.

Only one check-in should succeed.

The other must receive:

```text
ALREADY_CHECKED_IN
```

This guarantee must come from backend/database behavior.

Do not depend on frontend state or a temporary client-side flag.

---

# 4.16 Check-In Records

Check-ins should be recorded.

At minimum:

```text
ticket
event
checked_in_at
checked_in_by
method
```

Possible methods:

```text
QR_SCAN
MANUAL
```

Potential future metadata:

```text
device
entrance/gate
```

The organizer should be able to see:

- Total checked in
- Total expected
- Individual ticket status
- Check-in timestamp
- Whether check-in was manual or scanned

---

# 4.17 Manual Attendee Search

QR scanning must not be the only way to admit someone.

Staff should be able to search by:

- Name
- Email
- Phone
- Ticket reference
- Order reference

They should then be able to:

- Inspect the relevant ticket
- Confirm the ticket type/status
- Perform a manual check-in

This provides recovery for:

- Broken phones
- Lost email
- Damaged printouts
- QR scan problems
- Low screen brightness
- Customer confusion

---

# 4.18 Organizer Dashboard

The V1 dashboard should focus on operationally useful information.

Display:

```text
Total orders
Tickets sold
Gross ticket revenue
Sales by ticket type
Remaining inventory
Recent orders
Total attendees
Checked-in attendees
Refunded tickets
Cancelled tickets
```

Example ticket sales view:

```text
Early Bird    152 / 200
Regular       310 / 500
VIP            73 / 100
Tables          8 / 10
```

Revenue reporting should distinguish:

```text
Gross sales
Refunds
Paystack charges where known
TicketSquare/service fee where applicable
Net amount
```

Do not invent accounting values when exact provider fees are unavailable.

Make clear which numbers are calculated internally and which come from Paystack.

---

# 4.19 Attendee List

Provide an attendee/ticket table.

Useful fields may include:

```text
Attendee name
Email
Phone
Ticket type
Ticket reference
Order reference
Payment status
Ticket status
Check-in status
Promoter
Purchase date
```

Useful filters:

- Ticket type
- Checked-in status
- Ticket status
- Promoter
- Purchase/payment status

---

# 4.20 CSV Export

Allow organizers to export:

- Attendees
- Orders
- Ticket sales
- Check-ins

CSV is sufficient initially.

Excel-specific export can come later.

Before the event, the organizer should be able to export a complete attendee list for operational backup.

---

# 4.21 Promoter Tracking

If promoters are being used for the event, V1 should support basic promoter attribution.

A promoter may have:

```text
name
code
referral URL
active status
```

Example:

```text
ticketsquare.ng/events/event-name?ref=james
```

An order generated from the link/code should retain promoter attribution.

Reporting should show:

```text
Promoter
Orders generated
Tickets sold
Revenue generated
```

V1 does not need:

- Automated promoter commissions
- Promoter wallets
- Promoter payouts
- Promoter rankings
- Separate promoter dashboards

However, the attribution model should be clean enough for those features to be added later.

---

# 4.22 Promo Codes

Support discount codes.

Initial discount types:

```text
FIXED_AMOUNT
PERCENTAGE
```

Possible fields:

```text
code
discount type
discount value
usage limit
times used
valid from
valid until
active/inactive
event
applicable ticket types
```

Discount application must be calculated on the server.

Usage limits must be concurrency-safe.

The system should prevent:

- Overuse beyond the limit
- Expired code use
- Invalid ticket-type use
- Invalid event use
- Negative order totals

---

# 4.23 Refunds and Cancellations

Refund handling may initially be administrator-driven rather than fully self-service.

However, the internal state must remain correct.

A refunded or cancelled ticket must immediately become invalid for entry.

Ticket status should transition to:

```text
REFUNDED
```

or:

```text
CANCELLED
```

where appropriate.

The system should record:

- Refund amount
- Refund reason where useful
- Paystack/provider reference
- Refund status
- Refund timestamp

Reporting should distinguish refunds from sales.

Do not assume that every cancelled ticket implies a financial refund.

---

# 5. Event-Day Reliability

Event-day operations are one of the highest-risk parts of the product.

A marketing page problem may be inconvenient.

A payment or check-in failure during the event may directly affect customers and operations.

The entrance should not depend on one device.

Support multiple simultaneous scanner devices.

Before the event:

- Test scanning on several phones
- Test duplicate scans
- Test multiple simultaneous scans
- Test manual attendee lookup
- Test manual check-in
- Export attendee backups
- Test venue connectivity
- Test the expected check-in load
- Ensure staff understand validation states
- Have a fallback operating procedure

---

# 5.1 Poor Internet

Internet connectivity may be unreliable at the venue.

V1 does not necessarily need full offline synchronization because that introduces significant complexity.

However, avoid architecture decisions that would make offline support unnecessarily difficult later.

For the first event:

- Test venue connectivity beforehand
- Have more than one network option where practical
- Keep attendee exports available
- Have manual fallback procedures
- Ensure there are multiple scanning phones

True offline scanning can be added later.

---

# 6. Suggested V1 Domain Model

Possible initial entities:

```text
User
Event
TicketType
Order
OrderItem
Payment
Ticket
Attendee
CheckIn
Discount
DiscountRedemption
Promoter
PromoterAttribution
Refund
AuditLog
```

Not every entity must necessarily be a separate table if the resulting model would be needlessly complex.

The purpose of this list is to identify the domain concepts, not prescribe an exact ORM structure.

Potential later entities:

```text
Organization
OrganizationMember
StaffMember
GuestList
GuestListEntry
PayoutAccount
Settlement
Payout
TicketTransfer
ResaleListing
ResaleTransaction
OrganizerFollower
Notification
RecurringEventRule
Venue
Seat
```

Do not build all future entities during V1.

---

# 7. Architecture

Start with a **modular monolith**.

Do not begin with microservices.

Possible modules:

```text
Auth
Events
Ticketing
Orders
Payments
CheckIn
Discounts
Promoters
Notifications
Reporting
Admin
```

Potential later modules:

```text
Organizations
Payouts
Transfers
Resale
Discovery
Messaging
```

The modules may share a database initially.

Maintain sensible dependency boundaries so one module does not become tightly coupled to every other module.

The architecture should be easy to understand and operate.

---

# 8. Database

Use a relational database.

PostgreSQL is a strong default.

The database should ultimately enforce critical invariants around:

- Inventory
- Orders
- Payments
- Ticket identity
- Ticket validity
- Check-ins
- Promo-code use
- Refund references where relevant

Use appropriate:

- Foreign keys
- Unique constraints
- Transactions
- Atomic updates
- Indexes

Do not rely exclusively on application code for critical correctness.

---

# 9. Time and Timezones

Store timestamps in UTC.

Events should have an explicit timezone.

Convert times to the event timezone for display.

Do not assume:

- Server timezone
- Developer timezone
- Browser timezone
- Event timezone

are the same thing.

For TicketSquare's initial Nigerian event, the event timezone will likely be `Africa/Lagos`, but the architecture should not hard-code this assumption globally.

---

# 10. Idempotency

Any operation that may be retried should be designed accordingly.

Especially:

- Paystack webhooks
- Payment confirmation
- Ticket issuance
- Refund callbacks
- Email jobs
- Other external callbacks

Do not assume external providers deliver events exactly once.

Critical operations should remain correct under retries.

---

# 11. Audit Logging

Important financial, admission, and administrative actions should be auditable.

Potential audit events:

```text
EVENT_CREATED
EVENT_UPDATED
TICKET_TYPE_CREATED
TICKET_TYPE_UPDATED
ORDER_CREATED
PAYMENT_INITIALIZED
PAYMENT_CONFIRMED
PAYMENT_FAILED
TICKET_ISSUED
TICKET_CANCELLED
TICKET_REFUNDED
TICKET_CHECKED_IN
CHECK_IN_REVERSED
DISCOUNT_CREATED
DISCOUNT_UPDATED
REFUND_REQUESTED
REFUND_CONFIRMED
```

Audit logs should contain enough context for operational investigation.

Do not store:

- API secrets
- Passwords
- Full payment credentials
- Unnecessary sensitive information

---

# 12. Security Principles

Treat TicketSquare as both:

- A financial system
- An access-control system

At minimum:

- Validate all untrusted input server-side
- Verify Paystack webhook signatures
- Keep Paystack secret keys server-side
- Never place secret keys in frontend bundles
- Use HTTPS in production
- Protect organizer/admin endpoints
- Validate authorization server-side
- Use secure authentication/session handling
- Hash passwords appropriately if passwords are used
- Rate-limit sensitive endpoints
- Avoid predictable ticket credentials
- Do not trust client-submitted prices
- Do not trust client-submitted totals
- Do not expose internal stack traces to users
- Avoid leaking ticket access through predictable identifiers
- Keep dependencies reasonably current
- Use secure secret management in deployment

---

# 13. Coding Standards and Engineering Practices

The codebase should prioritize:

- Correctness
- Maintainability
- Clarity
- Testability
- Operational reliability

over cleverness.

---

## 13.1 General Principles

Prefer:

- Simple code
- Explicit behavior
- Small focused functions
- Cohesive modules
- Clear names
- Predictable control flow
- Appropriate abstractions

Avoid:

- Premature abstraction
- Premature optimization
- Deeply nested logic
- Magic values
- God classes/services
- Generic helper dumping grounds
- Hidden side effects
- Speculative infrastructure
- Clever tricks that make code harder to review

Refactor when complexity becomes real rather than predicting every future need.

---

## 13.2 Separation of Concerns

Keep domain logic separate from:

- HTTP controllers
- Database adapters
- Third-party providers
- UI components

Bad:

```text
PaystackWebhookController
    parses event
    calculates totals
    queries inventory
    marks order paid
    creates tickets
    creates QR codes
    sends email
    updates dashboard counters
```

Better:

```text
PaystackWebhookController
        ↓
PaymentApplicationService
        ↓
Order/Payment domain logic
        ↓
TicketIssuanceService
        ↓
Notification queue/service
```

Controllers should primarily:

- Parse input
- Authenticate/authorize
- Validate request shape
- Call application/domain logic
- Map result to HTTP response

---

## 13.3 External Provider Boundaries

External services should live behind clear boundaries where practical.

Example:

```text
PaymentGateway
    └── PaystackPaymentGateway

EmailProvider
    └── ConcreteEmailProvider

TicketRenderer
    └── PdfTicketRenderer
```

Do not over-engineer this into an elaborate framework.

The main objective is to prevent Paystack/email/PDF-specific logic from leaking throughout the application.

---

## 13.4 Domain Errors

Handle expected business conditions explicitly.

Examples:

```text
TicketSoldOut
InvalidPromoCode
PromoCodeExpired
OrderAlreadyPaid
PaymentVerificationFailed
TicketAlreadyCheckedIn
TicketCancelled
TicketRefunded
TicketNotFound
WrongEvent
```

These are normal domain conditions, not necessarily unexpected system failures.

Avoid collapsing every failure into:

```text
500 Internal Server Error
```

---

## 13.5 Validation

Validation should occur at appropriate layers.

Frontend validation:

- Improves UX

Backend validation:

- Guarantees application correctness

Database constraints:

- Protect critical invariants

Never depend solely on frontend validation.

---

## 13.6 Transactions

Use database transactions for operations that must succeed or fail together.

Examples include payment confirmation and ticket issuance.

A possible payment-confirmation transaction may include:

```text
verify current order/payment state
mark payment successful
mark order paid
commit inventory state
create tickets
```

Exact boundaries may differ depending on the inventory reservation design.

Avoid partially completed financial state.

Check-in transitions must also be atomic.

---

## 13.7 Concurrency

Explicitly consider race conditions around:

- Final ticket inventory
- Temporary inventory reservations
- Promo-code usage limits
- Duplicate payment callbacks
- Ticket issuance
- Check-in
- Refund state changes

Do not solve concurrency with frontend flags.

Use appropriate database techniques such as:

- Atomic conditional updates
- Transactions
- Row locks where justified
- Unique constraints
- Optimistic concurrency where appropriate

---

## 13.8 Testing

Critical business logic should have automated tests.

High-priority areas:

### Orders

- Correct totals
- Multiple ticket types
- Invalid quantities
- Sold-out tickets
- Server-authoritative pricing

### Discounts

- Percentage discounts
- Fixed discounts
- Usage limits
- Expiration
- Ticket restrictions
- Event restrictions
- Invalid codes
- Concurrent use near usage limit

### Payments

- Successful confirmation
- Failed payment
- Duplicate webhook
- Already-paid order
- Incorrect amount
- Incorrect currency
- Incorrect provider reference
- Invalid webhook signature
- Delayed webhook
- Retried webhook

### Ticket issuance

- Correct number of tickets
- Unique public references
- Unique QR credentials
- No duplicate issuance after repeated payment events

### Check-in

- Valid ticket
- Duplicate check-in
- Cancelled ticket
- Refunded ticket
- Wrong event
- Invalid ticket
- Manual check-in
- Concurrent scans

### Inventory

- Correct availability
- No overselling
- Final-ticket race condition
- Failed/expired reservation behavior if reservations are implemented

Prefer useful unit/integration/end-to-end tests over chasing a meaningless coverage percentage.

---

## 13.9 Database Migrations

Use migrations for all schema changes.

Do not manually alter production database schemas.

Migrations should be committed alongside the application code that depends on them.

Avoid destructive migrations where practical.

---

## 13.10 Configuration

Keep environment-specific configuration outside source code.

Examples:

```text
DATABASE_URL
PAYSTACK_SECRET_KEY
PAYSTACK_PUBLIC_KEY
EMAIL_API_KEY
APP_URL
SESSION_SECRET
```

Provide:

```text
.env.example
```

Do not commit real secrets.

Validate required environment variables at application startup.

Fail clearly when required configuration is missing.

---

## 13.11 Logging

Use structured logging where practical.

Logs should make it possible to trace important flows by contextual identifiers.

Useful fields include:

```text
event_id
order_id
payment_id
payment_reference
ticket_id
ticket_reference
user_id
```

Never log:

- Passwords
- API secrets
- Full card/payment credentials
- Sensitive information unnecessarily

---

## 13.12 API Design

Use consistent API conventions.

Possible examples:

```text
GET    /events/:id
POST   /events
PATCH  /events/:id

GET    /events/:id/ticket-types
POST   /events/:id/ticket-types

POST   /orders
GET    /orders/:id

POST   /payments/paystack/initialize
POST   /webhooks/paystack

GET    /tickets/:reference

POST   /events/:eventId/check-ins
GET    /events/:eventId/check-ins
```

These are examples, not mandatory route names.

Prefer consistent resource-oriented APIs unless another design is clearly better.

---

## 13.13 Type Safety

If using TypeScript:

- Enable strict mode
- Avoid unnecessary `any`
- Use explicit domain types
- Validate runtime data
- Prefer exhaustiveness for important state handling

TypeScript types do not validate external input.

Treat these as untrusted:

- HTTP requests
- Paystack payloads
- Environment variables
- Third-party API responses
- User-submitted JSON

---

## 13.14 Comments

Use comments to explain:

- Why a non-obvious decision exists
- Important business constraints
- Concurrency assumptions
- External provider quirks
- Security-sensitive behavior

Do not comment obvious syntax.

Bad:

```text
// increment count
count++;
```

Useful:

```text
// The update must remain atomic because multiple entrance devices
// may attempt to check in the same ticket simultaneously.
```

---

## 13.15 Naming

Use domain language consistently.

Prefer:

```text
Event
TicketType
Order
OrderItem
Payment
Ticket
CheckIn
Promoter
Discount
Refund
```

Avoid vague names like:

```text
Thing
Data
Stuff
Manager
Helper
Util
Processor
```

unless they genuinely describe the abstraction.

---

## 13.16 Avoid Product Branding in Domain Types

Although the product is called TicketSquare, avoid names such as:

```text
TicketSquareTicket
TicketSquareOrder
TicketSquareEvent
```

Prefer:

```text
Ticket
Order
Event
```

TicketSquare branding belongs primarily in:

- UI
- Emails
- Generated tickets
- Site metadata
- Configuration
- Marketing content

---

# 14. Repository Structure

The exact structure should depend on the chosen stack.

A possible full-stack repository:

```text
ticketsquare/
│
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── shared/
│   ├── ui/
│   └── config/
│
├── docs/
│   ├── architecture.md
│   └── product.md
│
├── .env.example
├── README.md
└── package.json
```

However, do not force a monorepo simply because this example exists.

If a single full-stack application is simpler and suits the chosen framework, prefer the simpler structure.

---

# 15. V1 Explicit Non-Goals

Do **not** allow these features to delay the first event:

- Native iOS app
- Native Android app
- Public event discovery marketplace
- Recommendation engine
- Ticket resale
- Ticket transfer
- Organizer followers
- Organizer public storefronts
- Multi-country operations
- Multi-currency settlement
- Recurring events
- Virtual events
- Embedded external-site checkout
- Advanced analytics
- Complex organization RBAC
- Promoter payouts
- Automated organizer payouts
- Full offline scanning
- Memberships
- Reserved seating
- Seating charts
- Recommendation feeds
- Social features

These belong to later phases unless the requirements of the real event materially change.

---

# 16. Phase 1 — Run Our Own Event

The first release should reliably support:

```text
Event setup
Public event page
Ticket categories
Inventory
Checkout
Paystack
Orders
Payments
QR tickets
Digital tickets
Printable tickets
Email delivery
Ticket retrieval
Organizer dashboard
Attendee list
QR scanning
Manual attendee lookup
Manual check-in
Multiple scanners
Promoter attribution
Promo codes
Refund/cancellation handling
CSV exports
Basic accounting/reporting
```

Success means:

- Customers can buy tickets without assistance
- Successful payments consistently produce valid tickets
- Failed payments do not produce valid tickets
- Duplicate payment callbacks do not create duplicate admissions
- Ticket inventory does not oversell
- Tickets can be retrieved
- Digital and printed tickets work
- Entrance scanning works reliably
- Duplicate scans are blocked
- Multiple scanners can operate simultaneously
- Staff can recover manually when something goes wrong
- Organizers can reconcile sales and attendance
- Relevant data can be exported before the event

---

# 17. Phase 2 — Reusable Organizer Platform

Once the first event has proven the core product, TicketSquare can begin supporting external organizers.

## 17.1 Organizations

Introduce concepts such as:

```text
Organization
OrganizationMember
Role
Permission
```

Potential roles:

```text
OWNER
ADMIN
FINANCE
EVENT_MANAGER
CHECK_IN_STAFF
```

---

## 17.2 Multi-Organizer Support

Organizations should eventually be able to:

```text
create organization
create events
configure ticket types
sell tickets
manage staff
manage attendees
view reports
manage payouts
```

---

## 17.3 Platform Fees

Introduce TicketSquare service fees.

Possible configuration:

```text
percentage fee
fixed fee
organizer absorbs fee
attendee pays fee
```

TicketSquare service fees should remain distinct from Paystack fees.

---

## 17.4 Organizer Payouts

Once TicketSquare begins collecting or settling money on behalf of external organizers, payout infrastructure becomes necessary.

Potential entities:

```text
PayoutAccount
Settlement
Payout
PayoutReport
```

This area should receive significant accounting, compliance, and operational scrutiny.

Do not casually build payout logic based only on the requirements of the first event.

---

## 17.5 Expanded Promoter Features

Future promoter functionality may include:

```text
Promoter accounts
Promoter dashboards
Commission rules
Sales targets
Leaderboards
Commission calculations
Promoter payouts
```

The V1 promoter attribution model should make this expansion possible without requiring the entire system to be rewritten.

---

## 17.6 Guest Lists

Support guest admission for categories such as:

```text
VIP
media
sponsors
staff
complimentary guests
```

Guest-list admissions should still be capable of receiving proper scannable credentials where appropriate.

---

## 17.7 WhatsApp Integration

Potential uses:

- Ticket delivery
- Purchase confirmation
- Event reminders
- Event updates
- Organizer communication
- Marketing with appropriate consent

WhatsApp should complement the core ticket retrieval system rather than becoming the only place a ticket exists.

---

# 18. Phase 3 — Consumer Marketplace

Once TicketSquare has enough events and organizers, add stronger attendee-facing discovery features.

Potential additions:

## Event Discovery

```text
Browse events
Search
Categories
Location filtering
Date filtering
Featured events
```

## Organizer Profiles

Public pages containing:

```text
name
description
social links
upcoming events
past events
```

## Organizer Following

Attendees may follow organizers and receive notifications about future events.

## Attendee Accounts

Attendee accounts may contain:

```text
profile
upcoming tickets
past tickets
purchase history
saved details
```

## Ticket Wallet

A central place for:

```text
active tickets
past tickets
cancelled tickets
refunded tickets
```

---

# 19. Phase 4 — Advanced Ticketing

Potential future features include:

## 19.1 Ticket Transfers

Allow ticket ownership to be transferred.

When transfer completes:

- Old holder should no longer have a valid credential
- New holder becomes the recognized attendee
- Transfer should be auditable

---

## 19.2 Ticket Resale

Controlled first-party resale marketplace.

Potential requirements:

- Organizer must explicitly allow resale
- Original ticket becomes invalid after successful resale
- Ownership is transferred safely
- Only one valid credential remains
- Price limits/rules may be applied
- Resale fees may be applied

---

## 19.3 Offline Check-In

True offline entry support may later be required.

Possible model:

```text
Download event credential dataset
↓
Validate locally
↓
Record local check-ins
↓
Reconnect
↓
Sync check-ins
↓
Resolve conflicts
```

This is a substantial distributed-state problem and should be deliberately designed.

Do not improvise an offline scanner shortly before an event.

---

## 19.4 Multi-Currency

Future currency support may require:

- Provider support
- Currency-specific fees
- Accounting
- Settlement rules
- Refund behavior
- Tax considerations
- Exchange-rate considerations

Multi-currency support is more than formatting a different currency symbol.

---

## 19.5 Reserved Seating

Potential future concepts:

```text
Venue
Section
Row
Seat
SeatMap
SeatHold
Reservation
```

Reserved seating introduces concurrency and temporary-hold requirements significantly beyond general admission.

---

# 20. Long-Term Product Direction

TicketSquare may eventually cover the broader event lifecycle:

```text
Event creation
↓
Ticket sales
↓
Payments
↓
Promoter distribution
↓
Attendee management
↓
Admission
↓
Reporting
↓
Organizer settlement
↓
Audience retention
↓
Event discovery
```

The long-term opportunity is larger than issuing QR codes.

TicketSquare may eventually serve:

- Organizers
- Promoters
- Venues
- Event staff
- Attendees

However, expansion should follow demonstrated demand.

Do not build speculative features solely because established ticketing platforms have them.

---

# 21. Development Priorities

When there is a conflict between adding another feature and making the core system more reliable, prioritize reliability.

V1 priority order:

```text
1. Payment correctness
2. Inventory correctness
3. Ticket issuance
4. Ticket retrieval
5. QR/check-in correctness
6. Event-day recovery tools
7. Organizer visibility
8. Promoter and discount functionality
9. Visual polish
10. Additional features
```

A broken animation can wait.

A customer being charged without receiving a ticket cannot.

An imperfect dashboard chart can wait.

Two people being admitted with the same ticket cannot.

---

# 22. Guidance for Codex

When implementing TicketSquare:

1. Treat Phase 1 as the immediate target.
2. Do not implement future phases prematurely.
3. Prefer a modular monolith.
4. Keep architecture extensible without predicting every future requirement.
5. Use Paystack as the payment provider.
6. Treat server-side payment verification as authoritative.
7. Make payment callbacks idempotent.
8. Never use floating point for money.
9. Protect inventory from race conditions.
10. Protect check-in from duplicate concurrent use.
11. Give every admission a secure unique credential.
12. Ensure digital and printed tickets represent the same ticket.
13. Keep domain logic out of controllers and UI components.
14. Write tests for critical payment/ticket/check-in logic.
15. Use database transactions where state must change together.
16. Keep secrets outside source control.
17. Do not introduce microservices without a demonstrated need.
18. Prefer understandable, boring solutions over clever ones.
19. Document important architectural decisions.
20. Avoid large unrelated refactors while implementing features.
21. Keep the application runnable after each development checkpoint.
22. Inspect existing code before making changes.

Before implementing a substantial feature, ask:

```text
Does this help us successfully run the first event?
```

If the answer is no, it likely belongs in a later phase.

---

# 23. Incremental Implementation Strategy

Do **not** attempt to generate the entire TicketSquare application in one large pass.

Build it incrementally.

For each major stage:

1. Inspect the existing repository.
2. State what is being implemented.
3. Identify any important assumptions.
4. Make the smallest coherent set of changes.
5. Add/update relevant tests.
6. Run tests, type checks, linting, and builds.
7. Fix regressions before proceeding.
8. Summarize changes and important decisions.
9. Stop at an appropriate review checkpoint before beginning the next major subsystem.

Do not silently introduce major architectural decisions while implementing an unrelated feature.

---

# 24. Implementation Checkpoints

## Checkpoint 1 — Foundation

Set up:

```text
Technology stack
Project structure
Local development environment
Formatting
Linting
Type checking
Testing
Environment configuration
README
```

Identify major V1 architecture decisions.

Then stop for review.

---

## Checkpoint 2 — Database and Core Domain

Set up:

```text
Database
Migrations
Event
TicketType
Order
OrderItem
Payment
Ticket
```

Review:

- Relationships
- Constraints
- Money representation
- Order state model
- Ticket state model
- Inventory strategy

before moving into checkout.

---

## Checkpoint 3 — Basic Admin and Event Publishing

Implement:

```text
Organizer/admin authentication
Event creation/editing
Ticket-type management
Public event page
```

At this point:

- The organizer can configure an event
- The attendee can view the event and available tickets

---

## Checkpoint 4 — Orders and Inventory

Implement:

```text
Order creation
Order items
Authoritative server pricing
Inventory handling
Initial discount foundation where needed
```

Test:

- Pricing
- Invalid quantities
- Sold-out behavior
- Concurrency around final inventory

before real payment integration.

---

## Checkpoint 5 — Paystack

Implement:

```text
Paystack initialization
Payment records
Webhook endpoint
Signature verification
Transaction verification
Payment reconciliation
Idempotent confirmation
```

Do not move on until testing covers:

- Successful payment
- Failed payment
- Incorrect amount
- Duplicate webhook
- Delayed webhook
- Already-paid order
- Invalid signature
- Retry behavior

---

## Checkpoint 6 — Ticket Issuance

Implement:

```text
Ticket issuance
Secure QR credentials
Digital ticket page
Ticket retrieval
Printable ticket/PDF
```

Verify:

- Correct ticket count
- No duplicate issuance
- Digital and printed versions use the same admission credential

---

## Checkpoint 7 — Notifications and Organizer Views

Implement:

```text
Confirmation email
Order listing
Sales dashboard
Attendee list
CSV exports
```

Email failure should not break ticket issuance.

---

## Checkpoint 8 — Event Check-In

Implement:

```text
Mobile QR scanner
Ticket validation
Atomic check-in
Manual attendee search
Manual check-in
Check-in history/reporting
```

Test multiple devices scanning the same ticket simultaneously.

---

## Checkpoint 9 — Promoters, Discounts, Refunds

Implement:

```text
Promoter attribution
Promo codes
Refund state
Cancellation state
Reporting improvements
```

Do not overbuild promoter payouts or external organizer settlement.

---

## Checkpoint 10 — Production Readiness

Perform:

```text
End-to-end testing
Concurrency testing
Load testing
Event-day simulation
Venue connectivity testing
Backup preparation
Production configuration review
Deployment preparation
```

---

# 25. Do Not Code Ahead

Future requirements in this document exist to provide architectural context.

They are **not** instructions to implement those features now.

Knowing that TicketSquare may eventually support multiple organizations does not mean V1 needs:

```text
OrganizationServiceFactory
MultiTenantEventRepository
PayoutOrchestrationEngine
ResaleMarketplaceModule
```

Prefer code that can be changed cleanly later over code that tries to predict every future requirement today.

---

# 26. When Codex Should Surface a Decision

If a decision has substantial consequences for:

- Database design
- Payment correctness
- Authentication
- Inventory
- Ticket security
- Concurrency
- Check-in
- Deployment architecture

Codex should clearly state the decision and its reasoning before spreading it throughout the codebase.

For ordinary implementation details, choose a sensible convention and continue.

The goal is not to interrupt development constantly.

The goal is to catch expensive architectural mistakes early.

---

# 27. Definition of Progress

A feature is not complete simply because a UI exists.

Where applicable, completion includes:

```text
Database behavior
Domain/application behavior
Validation
Authorization
Error handling
Concurrency behavior
Tests
Frontend behavior
Operational failure cases
```

Prefer complete vertical slices.

Good:

```text
Create order
→ calculate correct total
→ validate inventory
→ persist order
→ return result
→ tests pass
```

Prefer this over:

```text
Half-built order screen
Half-built payment screen
Half-built dashboard
Half-built scanner
```

---

# 28. Keep the Repository Runnable

After each checkpoint, the repository should remain in a working state.

Do not intentionally leave:

- Broken builds
- Failing migrations
- Disabled tests without explanation
- Placeholder security logic in production paths
- Hard-coded secrets
- Temporary payment bypasses
- Dead code from abandoned approaches
- Untracked assumptions that later code depends on

Temporary scaffolding should be clearly marked and kept away from production-critical behavior.

---

# 29. Immediate Build Order

A sensible implementation sequence is:

```text
1. Project setup
2. Database and migrations
3. Basic authentication/admin access
4. Event model
5. Ticket types
6. Public event page
7. Orders
8. Inventory handling
9. Server-side pricing
10. Paystack initialization
11. Paystack webhook verification
12. Payment confirmation/idempotency
13. Ticket issuance
14. QR credentials
15. Digital ticket view
16. Printable ticket/PDF
17. Confirmation email
18. Ticket retrieval
19. Organizer sales/order dashboard
20. Attendee list
21. QR scanner
22. Check-in endpoint
23. Manual attendee search
24. Manual check-in
25. Promoter attribution
26. Promo codes
27. Refund/cancellation handling
28. CSV exports
29. Operational/event-day testing
30. Production readiness
```

Do not prioritize visual polish over completing the payment-to-ticket-to-check-in lifecycle.

---

# 30. Definition of Done for the First Event

Before TicketSquare is trusted for the real event, repeatedly test this full flow:

```text
Create an event
↓
Create multiple ticket categories
↓
Publish event
↓
Open event page on mobile
↓
Choose tickets
↓
Pay through Paystack
↓
Confirm backend receives/verifies payment
↓
Confirm correct number of tickets is issued
↓
Receive confirmation email
↓
Open ticket online
↓
Download/print ticket
↓
Scan digital ticket
↓
Receive VALID
↓
Perform check-in
↓
Scan digital ticket again
↓
Receive ALREADY_CHECKED_IN
↓
Scan printed version
↓
Receive ALREADY_CHECKED_IN
↓
Find attendee manually
↓
See correct check-in state
↓
See order in organizer dashboard
↓
See correct revenue
↓
Export attendee/check-in data
```

Also test failure and edge cases:

```text
Failed payment
Abandoned payment
Duplicate webhook
Delayed webhook
Invalid webhook signature
Incorrect payment amount
Incorrect payment currency
Already-paid order
Email delivery failure
Sold-out ticket category
Final-ticket race condition
Invalid promo code
Expired promo code
Promo usage limit race
Cancelled ticket
Refunded ticket
Invalid QR
Wrong-event QR
Two scanners using same ticket simultaneously
Lost ticket retrieval
Manual check-in
Multiple tickets in one order
```

The system is ready when these scenarios have predictable outcomes and operational recovery paths.

---

# 31. First Instruction to Codex

When starting this project, do **not** immediately implement the entire V1 specification.

Begin by:

1. Read this entire document.
2. Inspect the repository.
3. Propose the initial technology stack if not already decided.
4. Propose the repository structure.
5. Identify the key architectural decisions for V1.
6. Create the project foundation.
7. Configure formatting, linting, type checking, and automated tests.
8. Configure environment handling.
9. Create/update the README with development instructions.
10. Propose the initial database/domain model.
11. Explain the initial inventory strategy.
12. Explain the planned payment-confirmation/idempotency strategy.

Then stop at the first review checkpoint before implementing the remaining V1 features.

The guiding rule is:

> **Build TicketSquare as a sequence of reliable, reviewable vertical slices — not as one giant generated application.**