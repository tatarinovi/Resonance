# Matrix integration guards (Resonance notifications)

## States

- **Healthy**: messages reach the configured room or DM; `ProjectNotificationPolicy.matrix_room_last_success_at` updates on successful room send.
- **Encryption blocked**: HTTP 403 / encryption hints from the Matrix API → `matrix_room_encryption_blocked=true` on the matching `ProjectNotificationPolicy` row (when `matrix_project_room_id` matches the failing room). Further realtime room sends are skipped until policy is cleared manually or room is replaced with a compatible plain room.

## Bot / DM

- DM jobs use persisted `User.matrix_dm_room_id` when set (delivered via `send_room`); otherwise `send_dm` creates/resolves the DM.
- Lead overrides (`override_matrix_mxid`) allow routing when Matrix ID lives in project config instead of the user profile.

## Retry policy

Outbound worker uses exponential backoff and `dead_letter` after `MAX_ATTEMPTS`. In-app ledger rows are never rolled back on transport failure.
