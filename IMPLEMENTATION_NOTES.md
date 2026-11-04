# Implementation notes

The uploaded specification is captured in SPEC.txt. This delivery is being implemented from an empty repository.

The dependency registry and GitHub are reachable under network-enabled execution; default-environment DNS failures are not evidence of unavailable dependencies.

Current implementation uses a Next.js App Router host with a native JavaScript portal and Node SQLite service. Deviations from the prescribed TypeScript/React component architecture, Tailwind/shadcn, Prisma relational schema, Vitest and Playwright must be reviewed explicitly. Do not interpret the use of Next.js as full compliance with the prescribed stack.

No unattended delivery automation has been established: the scheduling connector returned an approval-policy error. The active session carries out development and verification.
