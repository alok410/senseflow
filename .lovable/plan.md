## Bind Secretary role to Demo Secretary

Mirror what we did for the Consumer role (DHARTI): while auth is disabled, the Secretary dashboard should load real data for the "Demo Secretary" account already in the database.

### Change

- `src/hooks/use-session.ts`
  - Add `TEST_SECRETARY_ID = "50dfaff9-6177-4437-b5b0-d404e7ce5264"` (Demo Secretary).
  - In `useSession`, when active role is `secretary`, return a stub user with that id (instead of the placeholder admin id currently used for both admin and secretary).
  - Admin keeps its existing placeholder stub.

### Follow-up

- Log as `v1.0.16` in `docs/BUGLOG.md`.
