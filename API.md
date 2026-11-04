# Backend API contract

All routes use `/api/v1`; success `{data}`, errors `{error:{code,message,requestId}}`. JSON requests. Mutations require browser Origin matching `APP_ORIGIN` (default `http://localhost:3000`). Session uses HttpOnly cookie. Demo accounts: student, student2, teacher, librarian, printer, merchant, admin, operator.

- GET auth/accounts; POST auth/demo-login `{userId}`; GET auth/me; POST auth/logout; POST auth/role `{role}`.
- GET home returns `{announcements,apps,counts:{reservations,printing,dining,unread}}`.
- GET apps; PUT/DELETE apps/:id/favorite; GET search?q=; GET notifications; POST notifications/:id/read or notifications/read-all.
- GET library/books, library/books/:id; GET me/reservations, me/loans; POST library/reservations `{bookId}`; POST library/reservations/:id/cancel; POST library/loans/:id/renew.
- GET printing/points. POST files `{name,base64}` returns file metadata including id/pageCount. GET files/:id/download.
- POST printing/quotes or printing/orders `{fileId,pointId,copies,colorMode:'BW'|'COLOR',duplex:boolean,binding:'NONE'|'STAPLE',pages:'all'|'1-3,5'}`. Quote returns amountCents/sheets/selectedPages/pricingSnapshot.
- GET printing/orders, printing/orders/:id; POST printing/orders/:id/cancel.
- GET dining/halls, dining/stalls, dining/stalls/:id, dining/stalls/:id/menu. Products id equals variantId in first demo.
- POST dining/orders `{stallId,items:[{variantId,quantity}],pickupDate:'YYYY-MM-DD',pickupSlot:'LUNCH'|'DINNER'}`; GET dining/orders, dining/orders/:id; POST dining/orders/:id/cancel.
- Creation of reservations/print orders/dining orders accepts Idempotency-Key header.
- GET admin/library/books|reservations|loans. POST admin/library/reservations/:id/ready|reject|fulfill; POST admin/library/loans/:id/return.
- GET admin/printing/orders; POST admin/printing/orders/:id/accept|start|ready|exception|resolve|confirm-payment|redeem. Exception requires `{reason}`, redeem `{token}` from owner's READY detail.
- GET admin/dining/orders; POST admin/dining/orders/:id/accept|prepare|ready|reject|confirm-payment|redeem. Redeem `{token}`.
- GET admin, admin/users, admin/organizations, admin/jobs, admin/audit, admin/integrations. POST admin/users/:id `{status:'ACTIVE'|'DISABLED'}`. POST admin/jobs/run executes reservation expiry once.

Known reduced P0: generic JSON records schema rather than Prisma relations; no custom role creation, scoped configuration editor, content/app CRUD, explicit job claim/retries. Worker cleans expired files and READY reservations every 60 seconds. No production identity/payment/device integration; all identities fictitious. PDF malware scanning remains preproduction TODO.

## Configuration management added
GET/POST `admin/apps|categories|content|organizations|roles|settings|messages`; POST/DELETE `admin/:resource/:id` as supported. Content body is plain text only (frontend must escape). Roles support low risk permission presets, system roles cannot be deleted. Only SUPER_ADMIN can assign roles/scopes with POST admin/users/:id `{roles,scope}`. Removing active role invalidates affected sessions. User status uses separate `{status}` submission.
GET/POST `admin/printing/points|prices`; GET/POST `admin/dining/stalls|products`; POST respective resource/:id updates. Print operator scope and merchant scope remain enforced. Merchant may update existing own resources only; creation requires SUPER_ADMIN. Print prices are applied to future quotes and snapshotted orders.
POST admin/jobs/run resets periodic tasks then executes once; POST admin/jobs/:id/retry retries that task. Jobs persist claim/lock, stale lock reclaim after 5 minutes, max 3 retries, next execution at 60 seconds. FILE_CLEANUP and RESERVATION_EXPIRY are built in. GET files/sample downloads a generated one-page demo PDF.

Current limitations replacing earlier draft notes: configuration CRUD and job locking/retry are implemented; custom low risk role definitions exist but do not yet dynamically confer built-in business permissions. Remaining backend gaps include normalized relational Prisma schema, comprehensive pagination/sorting, banner/recent-use operational editors, and production adapters. SQLite demo execution is not production capacity validation.

## P0 continuation
- Admin GET array responses are paginated: query page (default1), pageSize (default20,max100), q, status, sort=createdAt|updatedAt|name|title|status, order=asc|desc. Response data remains array; meta has page/pageSize/total/totalPages.
- home now includes banners, recentUses (embedded app), todos. POST apps/:id/use persists recent use. GET announcements and announcements/:id respects publication, target role and expiry.
- GET library/books/:id includes independent copies with id,barcode,status,location.
- admin/banners CRUD fields title/body/targetPath/enabled/sortOrder.
- admin/dining/inventory GET/POST fields variantId,date,slot,remaining,version(optional). Merchant scope is enforced; stale supplied version returns409.
- Printing resolve accepts resolution=cancel and reason to cancel EXCEPTION; default restores previous status. Cancellation clears pickup credential.
- Every record update increments version. New normalized-schema migration is still pending; generic records and transaction checks remain the demo persistence layer.
- Custom MANAGE_CONTENT permission is limited to content/banners. It does not allow stats, messages, apps, audit, integrations, settings, users or business operations.
- Demo app seed contains172 entries:5 ACTIVE core services and167 explicitly PLANNED entries across six campus categories. This catalog is not a claim of implemented external integrations.
- Reset: stop web+worker, APP_MODE=demo, node server/reset-demo.mjs --confirm=RESET_DEMO. Without exact confirmation or in production, reset refuses. Only a DB within the local storage directory is accepted.

## Additional local campus workflows
Eight new modules are local persisted workflows, not integrations to school finance, medical, identity, device or official certificate systems. Directory entries with the same local workflow are merged, with aliases searchable; remaining external services stay PLANNED.

GET `/services/:module` returns `{config,records,options}`; GET `/services/:module/:id` returns detail. POST `/services/:module` creates; POST `/:id/cancel` or `/:id/action` takes `{action,...}`. Operator paths use `/admin/services/:module` and `/admin/services/:module/:id/action`. Every record/detail contains `allowedActions` strings determined by the actual caller and state. POST operations support Idempotency-Key inside one SQLite transaction, including inventory reservation and stored response.

| Module | Create fields | States and operations |
|---|---|---|
| repairs | title,description,location | SUBMITTED → accept → ACCEPTED → start → PROCESSING → resolve → RESOLVED → owner close → CLOSED; operator reject from SUBMITTED; owner cancel from SUBMITTED |
| venues | venueId,date YYYY-MM-DD,slot,purpose | CONFIRMED; owner/operator cancel before start; same venue/date/hour conflicts409 |
| lost | title,description,location,type LOST or FOUND | OPEN; another user claim with reason → CLAIM_PENDING; publisher/operator confirm-return with claimId → RETURNED; close → CLOSED |
| activities | eventId | REGISTERED; duplicate active enrollment409; atomic capacity decrement; pre-start cancel restores once |
| feedback | title,description,category | SUBMITTED → process → PROCESSING → resolve → RESOLVED → owner close → CLOSED; owner initial cancel |
| certificates | type 在读证明/成绩证明/实习证明,purpose | SUBMITTED → approve/reject → APPROVED/REJECTED; approved reference has DEMO prefix and is not an official certificate |
| marketplace | title,description,priceCents integer,category | ACTIVE → owner sold/withdraw → SOLD/WITHDRAWN; operator withdraw |
| affairs | type 印章申请/差旅申请/教室借用/行政事项,title,description | SUBMITTED → operator approve/reject; local manual workflow only, no real finance or document issuance |

Operators are CAMPUS_OPERATOR or SUPER_ADMIN. Status processing takes a required reason, persisted as response. Users see only their private records; public lost/marketplace records omit userId and show a nickname. Claim reasons are returned only in detail to the publisher, that claimant, or operators. Each status mutation writes audit and durable deduplicated notifications in the same transaction.

Seed options include venue1–venue3 and event1–event3. Venue hour slots are09:00/10:00/14:00/15:00/19:00 Beijing time, one hour each, future30 days. GET/POST `/admin/services/venues/options` manages venue resources; `/admin/services/activities/options` manages events. Fields: id optional for update, name,location,capacity integer1–10000,enabled boolean; events also require startsAt ISO and description. Event capacity cannot fall below actual enrollment, remaining is recalculated, and enrolled events cannot change their start time.

Module business routes enforce the mapped application's status and role visibility. Custom roles additionally require VIEW_PORTAL to submit ordinary requests; MANAGE_CONTENT alone cannot submit or read private campus records.

### Follow-up workflow refinements
Lost-item claimants can retain access to their related post after RETURNED/CLOSED, with `isClaimant` and `myClaims` containing only their own claim outcomes. Detail claims remain restricted to the publisher, that claimant, or operators; public records never expose other claims.

`options.affairTypes` is authoritative for the local application form: 印章申请、差旅申请、教室借用、行政事项、学生请假、宿舍申请、学生证补办、档案转递、补考报名、重修申请. These are local submissions and manual reviews; they do not synchronize school systems or establish official decisions. Certificate and affairs records/details keep explicit notices.

`options.eventTypes`: 校园活动、志愿服务、竞赛报名. Event resource management accepts optional eventType; seed has a volunteer event and event4 creative challenge. Matching directory aliases are merged into the same functional module rather than counted as separately implemented external services.

Existing demo database upgrades merge official aliases while preserving custom aliases, update descriptions only when they match prior seed defaults, and preserve user-customized descriptions. ACTIVE card descriptions explain user tasks rather than implementation details.

## Six independent extensions
Workflow structure was informed by public project descriptions for [CampusStay](https://github.com/Anilpanchal12/CampusStay) and [Hostel Administration System](https://github.com/vineeth34064/HOSTEL-ADMINISTRATION-SYSTEM). No third-party code or dependencies were copied. These are local demonstrations, not official school actions or real courier/employer integrations.

GET `/extensions/:module` returns `{config,records,options,meta}`; GET `/:id` returns only the caller's record. POST root creates; POST `/:id/action` takes action. Admin paths prefix `/admin/extensions`. All records return allowedActions and a local-demo notice. Lists accept page/pageSize/q/status; pageSize defaults20, maximum100. All normal writes support Idempotency-Key with lookup, business changes and stored response in one transaction.

| Module | User submission | Actions |
|---|---|---|
| housing | reason | SUBMITTED; operator allocate with bedId/reason → ALLOCATED, reject → REJECTED; user initial cancel; allocated checkout → CHECKED_OUT frees bed. One active application per user and one occupied record per bed. |
| leaves | startDate,endDate YYYY-MM-DD,reason | SUBMITTED → operator approve/reject with reason; APPROVED → user return once leave starts, or user cancel before start. Inclusive overlaps with pending/approved requests rejected; maximum60 days. |
| parcels | operator-only create recipientId,trackingNumber,carrier | PENDING_PICKUP → operator redeem with token → COLLECTED. Random credential appears only in owner's single-record detail, never operator responses or lists; credential valid once. |
| equipment | deviceId,quantity integer1–5,purpose | REQUESTED atomically reserves stock; operator issue → ON_LOAN, return → RETURNED; user cancel or operator reject from REQUESTED restores stock once. |
| jobs | jobId,motivation | SUBMITTED → review → REVIEWED → interview → INTERVIEW → accept/reject; operator can accept/reject from REVIEWED. User withdraw from any nonterminal application. Active duplicate applications rejected. |
| surveys | surveyId,answers keyed by question ID | One answer per user/survey. Exact valid choice per question required. Operator endpoints expose aggregates only: `{surveyId,title,total,questions:[{id,title,counts:{choice:count}}]}`. No participant list or individual-answer endpoint. |

Options keys: beds/devices/jobs/surveys; parcel admin additionally has recipients. Seeds: bed1–bed6, device1–device3, job1–job3, survey1 with q1 choices 图书/食堂/打印/其他 and q2 满意/一般/待改进.

Resource management GET/POST `/admin/extensions/:module/options`, update by body.id and optional version:

- housing: building,room,label,enabled. Duplicate physical bed coordinates rejected.
- equipment: name,description,total,enabled. Total cannot drop below held/loaned quantity; remaining recalculated.
- jobs: title,employer,description,deadline ISO,enabled.
- surveys: title,questions array `{id,title,options:[strings]}`,endsAt ISO optional,enabled. 1–20 single-choice questions, 2–8 unique options per question. Once answered, questions cannot change.

Survey anonymous answers and duplicate-participation markers are stored separately. Personal confirmation records contain no answers. Survey audit uses an anonymous actor and does not publish identifiable submission notifications; this is API-level aggregate privacy, not cryptographic anonymity against a database administrator. Other status changes audit and notify atomically.

Student leave and housing application entries now route to these independent workflows; generic affairs no longer accepts new 学生请假/宿舍申请 submissions, but preserves historical records.
