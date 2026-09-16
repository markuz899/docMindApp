# JWT authentication

Authentication is stateless. A successful `POST /login` returns a signed **JWT**
access token and an opaque refresh token.

## Access token

| Claim | Meaning                                   |
| ----- | ----------------------------------------- |
| `sub` | the `users.id` of the authenticated user  |
| `sid` | session id, used for refresh revocation   |
| `exp` | expiry, 15 minutes after issuing          |
| `scp` | space-separated scopes                    |

The token is signed with HS256 using `JWT_SECRET`. Tokens are **not**
encrypted; never put profile data inside the claims.

## AuthMiddleware

`AuthMiddleware` runs before every protected route:

1. Read the `Authorization: Bearer <token>` header.
2. Verify the signature and `exp` with `TokenService.verify()`.
3. Load `sub` into `request.userId`.
4. Reject with `HTTP 401` when the header is missing or the token is invalid.

`AuthMiddleware` does **not** load the user record. It only puts the id on the
request; loading is the job of `UserService`.

## Refresh

`POST /refresh` exchanges a refresh token for a new access token. The refresh
token is stored hashed in `sessions` and revoked on `POST /logout`.

## Scopes

- `profile:read` — required by `GET /me` and `GET /profiles/{handle}`.
- `profile:write` — required by `PATCH /me`.
