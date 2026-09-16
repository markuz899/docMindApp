# Main flows

## Login flow

1. `SessionController.login()` validates the payload.
2. `UserService.authenticate()` loads the row via `UserRepository.findByEmail()`.
3. The password hash is compared with Argon2.
4. `TokenService.issue()` signs the JWT and stores the session.

## Current user flow

This is the flow behind `GET /me`.

1. `AuthMiddleware` verifies the JWT and sets `request.userId` from the `sub`
   claim.
2. `UserController.me()` calls `UserService.getCurrentUser(request.userId)`.
3. `UserService` calls `UserRepository.findById(userId)` to load the account
   row from `users`.
4. `UserService` calls `ProfileService.getByUserId(userId)`, which reads the
   `profiles` row through `ProfileRepository`.
5. `UserService.mergeUserAndProfile()` builds the response DTO. Account fields
   win on conflict; profile fields fill the display data.
6. `UserController` serialises the DTO.

Important: step 4 uses **`user_id`**, not `handle`. A profile row is looked up
by the owning account, so a stale or duplicated `handle` cannot leak another
user's display data — but a wrong `user_id` in `profiles` can.

## Profile update flow

1. `ProfileController.update()` validates the handle.
2. `ProfileService.update()` checks uniqueness against `profiles.handle`.
3. The avatar is pushed to the external provider asynchronously.
4. The row is written through `ProfileRepository.update()`.

## Avatar synchronisation flow

`ProfileService` is the only component that calls the external avatar provider.
It is called from the profile update flow and from the nightly reconciliation
job. `UserService` never calls the provider directly.
