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
