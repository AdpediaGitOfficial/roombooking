# Staff Accommodation Management – Requirements Analysis

Prepared from the two supplied documents:

- **Scope of Work** (client RFP, 3 pages) – lists 12 module areas plus a proposal request.
- **Software Requirements Specification (SRS), "Staff Accommodation Management"** (13 pages, draft for stakeholder validation) – translates the Scope of Work into 89 numbered, prioritised requirements, a role model, a data model, workflows, an edge-case catalogue, status models, UX rules, non-functional requirements and integration dependencies.

## 1. State of the application

The `AdpediaGitOfficial/roombooking` repository is **empty**: no branches, no commits, no files on GitHub or locally. There is no existing application to study, so this analysis treats the project as a greenfield build and the decisions below are starting-point recommendations rather than a gap analysis against existing code.

One naming observation: the repository is called *roombooking*, but the Scope of Work describes a full staff accommodation platform of which room/facility booking is one module. The product name and repository name should be aligned early so the codebase, URLs and documentation do not describe a narrower product than the one being delivered.

## 2. What the client asked for (Scope of Work)

| # | Module | Capabilities named by the client |
|---|--------|----------------------------------|
| 1 | Accommodation Management | Building/villa/apartment/room/bed hierarchy; occupancy and availability; allocation and transfer; check-in/check-out; occupancy dashboard and utilisation reporting |
| 2 | Staff Self-Service Portal | Secure login; profile management; view own accommodation information |
| 3 | Maintenance Management | Request submission; work-order tracking; assignment workflow; vendor/contractor access to assigned tasks; pending-maintenance reports |
| 4 | Digital Forms & Approval Workflow | Room change, visitor stay, family accommodation and exit clearance forms; custom form builder; multi-level approvals |
| 5 | Facility Booking | Online reservation of common facilities; real-time availability; booking calendar and utilisation reports |
| 6 | Key Management | Issue/return tracking; lost/damaged keys; outstanding-key reports |
| 7 | Inventory Management | Accommodation inventory tracking; asset allocation and stock control |
| 8 | Lost & Found | Item registration/tracking; image attachments; claim and audit history |
| 9 | Communication & Notifications | WhatsApp, broadcast messaging, email |
| 10 | Reports & Analytics | Occupancy, staff movement, maintenance performance, facility utilisation, key reports |
| 11 | Administration & Security | Users and roles; audit trail; content management; RBAC; secure authentication |
| 12 | Platform | Web, desktop and mobile; cloud or on-premise; integrations; training/go-live; annual support |

The proposal request also asks for a technical proposal, timeline, training/support scope and a commercial quotation (licensing, setup, annual support, recurring fees). Those are commercial deliverables outside this codebase but the module list above is what the quotation must price.

## 3. What the SRS adds

### 3.1 Roles (10)

System Administrator, Accommodation Administrator, Accommodation Officer/Reception, Staff/Resident, Approver/Manager, Maintenance/Engineering, Vendor/Contractor, Inventory/Key Custodian, Facility Manager, Auditor/Read-only Manager.

Key access rules: deny by default; enforce on the server, not just in the UI; scope data by organisation/site/building; staff see only their own records; contractors see only assigned work orders with time-limited access; deactivation revokes sessions but preserves audit history; privileged actions record actor, time, target and change.

### 3.2 Core entities (14)

Organisation/Site, Building/Villa/Apartment, Room, Bed/Bedspace, Staff Profile, Accommodation Allocation, Request/Approval, Maintenance Work Order, Facility/Booking, Key/Key Transaction, Inventory Item/Asset, Lost-and-Found Item, Notification, Audit Event.

The integrity rules that drive the hardest engineering work are:

- A bed can have at most one active allocation for overlapping dates (needs a database-level exclusion constraint or equivalent, plus transactional re-validation).
- No facility reservation may exceed configured capacity under concurrent requests.
- A serialised asset cannot be allocated twice; stock cannot go negative.
- A key cannot be issued to multiple holders unless policy allows copies.
- Audit events are append-only.
- Approved requests must trigger their business action exactly once (idempotency keys on submissions and approvals).

### 3.3 Requirement counts by priority

| Area | P0 | P1 | P2 | Total |
|------|----|----|----|-------|
| ACM – Accommodation | 8 | 4 | 0 | 12 |
| SS – Self-Service | 5 | 3 | 0 | 8 |
| MNT – Maintenance | 5 | 3 | 0 | 8 |
| WF – Forms & Approvals | 5 | 3 | 0 | 8 |
| FAC – Facility Booking | 0 | 7 | 0 | 7 |
| KEY – Key Management | 4 | 2 | 0 | 6 |
| INV – Inventory | 0 | 6 | 0 | 6 |
| LF – Lost & Found | 0 | 4 | 1 | 5 |
| COM – Notifications | 2 | 5 | 0 | 7 |
| RPT – Reports | 1 | 7 | 0 | 8 |
| ADM – Admin & Security | 6 | 2 | 0 | 8 |
| PLT – Platform | 4 | 2 | 0 | 6 |
| **Total** | **40** | **48** | **1** | **89** |

P0 is defined as "essential launch capability". The P0 set is: the accommodation hierarchy, availability, allocation, transfer and check-in/out; the staff portal home, stay details, profile, request submission and status; maintenance ticket submission, assignment, progress notes and requester notification; the four standard request forms with sequential multi-level approval and exactly-once fulfilment; key registration, issue/return and exception recording; in-app/email notifications that never roll back a business action; the occupancy dashboard; user, role, reference-data, audit, authentication and data-retention administration; responsive web, deployment choice, go-live support and operational procedures.

### 3.4 Status models proposed by the SRS

- **Allocation**: Draft → Pending Approval → Confirmed/Allocated → Checked In → Checked Out/Completed; terminal alternatives Cancelled, Rejected, Expired.
- **Request/approval**: Draft → Submitted → Pending Approval → Changes Requested → Resubmitted → Approved/Rejected → Fulfilled/Closed.
- **Maintenance**: New → Triaged → Assigned → In Progress → Waiting (Staff/Parts/Access) → Resolved → Closed, with Reopened and Cancelled as controlled transitions.
- **Facility booking**: Pending Approval → Confirmed → Checked In/Completed; Cancelled, Rejected, Expired, No-show.
- **Key**: Available → Issued → Returned; exceptions Lost, Damaged, Under Repair, Retired.

### 3.5 Non-functional targets to confirm

Performance 2.5 s p95 page load; 99.5% monthly availability; TLS, encryption at rest, least privilege, rate limiting; SSO/MFA policy to confirm; WCAG 2.2 AA; localisation including possible right-to-left support; backup RPO/RTO to agree; observability (logs, health checks, job-queue monitoring); documented architecture, APIs, migrations, runbooks; CSV/XLSX/PDF exports; retention policy per data class.

### 3.6 Integrations

Email (required), WhatsApp Business Platform (required, provider and template approvals to confirm), and optional HRMS directory import, SSO, maps, SMS/push, smart locks. Only email and WhatsApp are in the baseline.

## 4. Gaps and tensions between the two documents

1. **Facility Booking is P1 in the SRS but a top-level module in the Scope of Work.** The client will expect it in the delivered product. Recommendation: keep it in the first release as a thin feature (list facilities, calendar, create/cancel booking with capacity check) and defer the configurable rules (FAC-05) and no-show tracking (FAC-06).
2. **Inventory and Lost & Found are entirely P1** in the SRS but are client-named modules. Same recommendation: a minimal CRUD plus status history in release 1 so every Scope of Work module is visibly present, with advanced rules (reorder thresholds, duplicate-item search) later.
3. **WhatsApp is P1** in the SRS but the client lists it first under notifications. The dependency is external (provider account, template approval, consent). Build the notification layer channel-agnostic from day one so WhatsApp is a provider plug-in, not a rewrite.
4. **Custom form builder (WF-02, P1)** versus "custom form creation capability" in the Scope of Work. Recommend storing all four standard forms as JSON schemas from the start so the builder is an admin UI over an existing mechanism rather than a new data model.
5. **"Content management" (ADM-03)** is only loosely defined: help text, reference data and operational configuration. Confirm with the client whether they expect a CMS for announcements/pages.
6. **Allocated vs Checked In** as separate states is flagged as a client decision; it affects occupancy counts (future-dated transfers must not change occupancy early).
7. **Check-out blockers**: the SRS requires check-out to show outstanding keys/assets and allow an authorised override. This couples Accommodation, Key and Inventory modules, so they cannot be built as fully independent services.
8. The SRS repeatedly marks items as "Decision required". None of those decisions are recorded in the Scope of Work, so they are open.

## 4a. Clarified: bed-level accommodation model

The client has confirmed that a room is a container for individually
tracked bed spaces, not a single allocation unit. The agreed model:

- **Beds are configured per room** by administrators. Room capacity is the
  number of beds in service; it is derived, not typed in.
- **Each bed has its own availability**, computed from allocations as of
  the site's local calendar date. Allocation statuses that hold a bed are
  Confirmed and Checked In; a bed can hold at most one such allocation for
  any overlapping date range (database exclusion constraint).
- **Bed configuration states**: *In service*, *Blocked* (temporary, with a
  mandatory reason, e.g. repair or cleaning), *Retired* (permanently out of
  capacity). A bed with a current occupant cannot be retired. Blocking a
  whole room marks its unoccupied beds as blocked.
- **Per-bed availability states** shown to administrators: *Occupied*
  (checked in), *Allocated, awaiting check-in* (confirmed allocation that
  has started), *Vacant*, *Blocked*, *Retired*. A future-dated confirmed
  allocation is shown as the bed's next arrival but does not change
  today's counts.
- **Room and building summaries**: total bed capacity, occupied (split into
  checked in and awaiting check-in), vacant, blocked, retired and upcoming
  arrivals, with the current occupant and dates listed per bed.

This supersedes the earlier reading of ACM-02 where room capacity was a
configured number. SRS requirement text for ACM-01, ACM-02, ACM-03 and
ACM-09 should be updated to match; the implementation already follows it.

## 5. Decisions required from the client before build

- Hosting: cloud (which region/provider) or on-premise; this affects authentication, email/WhatsApp egress and backups.
- Authentication: local accounts, SSO provider, MFA policy, account recovery.
- Confirm "Allocated, awaiting check-in" and "Checked In" as distinct bed states (both count as occupied in capacity figures); whether open-ended allocations are allowed.
- Approval routes per request type, delegation and escalation policy, self-approval exception policy.
- Whether a request pins the workflow version at submission (SRS recommends yes).
- Facility booking rules: duration, advance window, buffer, cancellation cutoff, per-user limits, no-show definition.
- Key policy: are duplicate copies allowed; who may record lost/damaged; approval needed?
- Inventory scope: stock control with reorder thresholds, or asset tracking only.
- WhatsApp provider/account ownership, template content, consent basis; email sending domain.
- HRMS import: system of record, field mapping, sync frequency.
- Languages, time zones per site, right-to-left requirement, date formats.
- Retention periods for staff data, photos, visitor/family requests, notifications and audit logs.
- Supported browsers and whether a PWA is wanted.
- Data volumes: sites, buildings, rooms/beds, staff, monthly requests, concurrent users.

## 6. Recommended delivery shape

### 6.1 Release plan

| Release | Content | Requirement IDs |
|---------|---------|-----------------|
| R1 – Core (all P0) | Org/site/building/room/bed hierarchy; availability and allocation with overlap protection; transfer; check-in/out; staff portal; four standard forms with multi-level approval; maintenance tickets with assignment; key register; in-app/email notifications; occupancy dashboard; users, roles, audit, auth | ACM-01..08, SS-01..05, MNT-01..05, WF-01,03,04,05,08, KEY-01..04, COM-01,06, RPT-01, ADM-01..05,08, PLT-01,02,04,05 |
| R2 – Module completeness | Facility booking (thin), inventory (thin), lost & found (thin), WhatsApp channel, broadcast, SLA tracking, contractor portal, blocks/maintenance holds, report suite with filters and export | FAC-01..04,07, INV-01..04,06, LF-01..04, COM-02..05,07, MNT-06..08, ACM-09,11, RPT-02..08, KEY-05,06 |
| R3 – Configuration and polish | Form builder, delegation/escalation, booking rule engine, reorder thresholds, bulk import, allocation correction, integration admin, PWA | WF-02,06,07, FAC-05,06, INV-05, ACM-10,12, ADM-06,07, PLT-03,06, LF-05 |

### 6.2 Architecture recommendation

Stack decision (confirmed): **Node.js, Next.js (App Router, TypeScript), PostgreSQL** with Prisma for schema and migrations. The repository has been scaffolded on this stack; see the README for setup. Design choices:

- **Modular monolith** with one relational database (PostgreSQL). Cross-module rules such as check-out blockers, exactly-once approval actions and transactional capacity checks are far simpler inside one transaction boundary than across services.
- **Database-enforced integrity**: exclusion constraint on bed allocations over date ranges, unique active-assignment constraint on serialised assets, check constraints on stock, append-only audit table with row-level security.
- **Workflow engine as data**: request types, form schemas (JSON), approval routes and status transitions stored in configuration tables, versioned, with the version pinned on each request.
- **Outbox pattern for notifications**: business actions commit first; a job queue delivers email/WhatsApp with retries, delivery state and idempotency keys (COM-04, COM-06, COM-07).
- **Server-side authorisation** on every endpoint with object-level checks (site/building scope, ownership), plus negative tests for the permission-escalation edge case.
- **Mobile-first web front end** with role-specific home screens (staff: Home, My Stay, Requests, Facilities, Help/Profile; operations: Dashboard, Accommodation, Allocations, Maintenance, Approvals, Facilities/Keys/Inventory, Lost & Found, Reports, Administration), installable as a PWA later.
- **Timezone-aware timestamps** stored in UTC with a site timezone for display and reporting boundaries.
- **File uploads** (maintenance photos, lost-and-found images) validated by type and size, virus-scanned, stored outside the database with signed access.

### 6.3 Immediate next steps

1. Confirm the open decisions in section 5 with the client, especially hosting, authentication and the allocation state model, since they shape the data layer.
2. Stack agreed and repository scaffolded (Next.js, Prisma, PostgreSQL schema with database-level integrity constraints, seed data). CI pipeline and vitest harness added. Authentication implemented: scrypt passwords, server-side sessions with revocation, lockout, audit of sign-in events, route gating (covers ADM-04/05 baseline and SS-01 login; SS-08 recovery, SSO and MFA pending client decisions).
3. Accommodation hierarchy and bed management implemented (overview, building and room views with per-bed availability; add, block, unblock, retire beds; block rooms). Allocation engine implemented (search, allocate, check-in, check-out with clearance blockers and override, same-day and future-dated transfer with linked history, cancel; audited; notification outbox). Covers ACM-04..08 and workflow 6.1/6.2 except the approval step, which arrives with the forms module. Staff self-service portal implemented (SS-01, SS-02, SS-03; in-app notification inbox for COM-01; password change as the SS-08 baseline). Digital forms and approvals implemented: WF-01, WF-03, WF-04, WF-05, WF-08, SS-04, SS-05, SS-06 and the 6.4 rules (self-approval blocked, mandatory reasons, concurrent decisions, pinned workflow version, preserved history, idempotent submission). Not yet: WF-02 form builder UI, WF-06 delegation, WF-07 expiry/escalation. Maintenance implemented: MNT-01..05 plus MNT-06 (SLA targets and overdue), MNT-07 (vendor scope and access expiry) and the queue summary from MNT-08; workflow 6.3 and status model 8.3. Key register implemented: KEY-01..04 plus KEY-05 handover from the allocation page and KEY-06 permanent history with register filters. Users and roles administration implemented (ADM-01, ADM-02, ADM-04 viewer, ADM-05 invite/reset links, SS-08 baseline) with last-administrator and self-change guards. Occupancy dashboard implemented (RPT-01, ACM-03, ACM-11 trend, RPT-06 site filter, RPT-07 audited CSV export). Email delivery implemented (COM-01, COM-04, COM-05, COM-06, COM-07; ADM-07 transport health and queue view). Release 1 is functionally complete. Release 2: facility booking, inventory, lost and found, WhatsApp transport, broadcast messaging, reports suite. → staff portal → forms/approvals → maintenance → keys → notifications → dashboard.
4. Write acceptance tests from the SRS edge-case catalogue (section 7 of the SRS) as the regression suite; the race-condition, double-submit and permission-escalation cases should be automated from the first sprint.
