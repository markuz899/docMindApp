# API reference

All routes are prefixed with `/api/v1`. All responses are JSON.

## POST /login

Exchanges credentials for a JWT access token.

Request:

```json
{ "email": "ada@example.com", "password": "..." }
```

Responses: `200` with tokens, `401` on bad credentials, `429` when rate limited.

## GET /me

Returns the **authenticated user's own record**, merged with their profile.

Handled by `UserController.me()`, which calls `UserService.getCurrentUser(userId)`.

Requires the `profile:read` scope.

Response body:

```json
{
  "id": "usr_01H...",
  "email": "ada@example.com",
  "emailVerified": true,
  "handle": "ada",
  "displayName": "Ada Lovelace",
  "avatarUrl": "https://cdn.acme.dev/avatars/ada.png",
  "createdAt": "2023-04-02T10:15:00Z"
}
```

Field sources — this is the part that is most often misread:

| Field          | Table      | Loaded by           |
| -------------- | ---------- | ------------------- |
| `id`           | `users`    | `UserRepository`    |
| `email`        | `users`    | `UserRepository`    |
| `emailVerified`| `users`    | `UserRepository`    |
| `handle`       | `profiles` | `ProfileRepository` |
| `displayName`  | `profiles` | `ProfileRepository` |
| `avatarUrl`    | `profiles` | `ProfileRepository` |

`GET /me` never reads another user's row. If the caller needs somebody else's
data, use `GET /users/{id}` or `GET /profiles/{handle}`.

Errors: `401` when the token is missing or expired, `403` when the scope is
missing, `404` when the account was deleted but the token is still valid.

## PATCH /me

Updates the display fields of the authenticated user. Only `displayName` and
`avatarUrl` are writable; `email` changes go through `POST /me/email-change`.

Handled by `UserController.updateMe()` → `UserService.updateCurrentUser()`.

## GET /users/{id}

Administrative route. Requires the `admin` scope. Returns the raw `users` row
without any profile merge.

## GET /profiles/{handle}

Public profile lookup. Handled by `ProfileController` → `ProfileService`.
Returns only `profiles` columns, never an email address.

## POST /logout

Revokes the current session. Always returns `204`.
