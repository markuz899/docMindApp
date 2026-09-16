# Architecture

The service is a three-layer HTTP application. Requests always travel in the
same direction: controller → service → repository → database.

## Layers

### Controllers

Controllers parse and validate the HTTP request, call exactly one service
method, and map the result onto a response DTO. They never touch the database.

- `UserController` — `/me`, `/users`, `/users/{id}`
- `ProfileController` — `/profiles/{handle}`
- `SessionController` — `/login`, `/logout`, `/refresh`

### Services

Services hold the business rules and own transactions.

- `UserService` — reads and updates the authenticated user, and is the only
  place that merges account data with profile data.
- `ProfileService` — public profile rendering, handle uniqueness, avatar
  synchronisation with the external provider.
- `TokenService` — signs, verifies and refreshes JWT tokens.

### Repositories

Repositories are thin data-access objects around SQL. They return rows, never
DTOs.

- `UserRepository` — `users` table.
- `ProfileRepository` — `profiles` table.

## Dependency rules

- `UserController` depends on `UserService` only.
- `UserService` depends on `UserRepository` and on `ProfileService`.
- `ProfileService` depends on `ProfileRepository` and on the external avatar
  provider client.
- No repository may call a service. No service may call a controller.

## Why UserService depends on ProfileService

The `/me` response is a *merged* view: account fields come from `users`,
display fields come from `profiles`. `UserService.getCurrentUser()` performs the
merge so that no controller has to know about two repositories.
