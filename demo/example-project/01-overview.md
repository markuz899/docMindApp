# Acme Identity API — Overview

Acme Identity is the service that owns accounts, sessions and public profiles
for every Acme product. It exposes a small REST surface over HTTP and is the
only service allowed to write to the `users` and `profiles` tables.

## What this service is responsible for

- Registering and authenticating users with email + password.
- Issuing and refreshing **JWT** access tokens.
- Serving the authenticated user's own record through `GET /me`.
- Serving public profile data through `GET /profiles/{handle}`.
- Synchronising avatar images with the external provider (Gravatar-compatible).

## What this service is not responsible for

- Billing (owned by `acme-billing`).
- Notifications (owned by `acme-notify`).
- Any write to the `orders` table.

## Repository layout

```
src/
  controllers/   UserController, ProfileController, SessionController
  services/      UserService, ProfileService, TokenService
  repositories/  UserRepository, ProfileRepository
  middleware/    AuthMiddleware
  db/            migrations and seeds
```

## Reading order

1. `02-architecture.md` — how the layers talk to each other.
2. `03-authentication.md` — JWT authentication and session handling.
3. `04-api-reference.md` — every route, including `GET /me`.
4. `05-main-flows.md` — end-to-end flows.
5. `06-data-model.md` — the `users` and `profiles` tables.
