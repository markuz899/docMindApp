# Configuration

All configuration is read from environment variables at boot. A missing
required variable stops the process with exit code 78.

| Variable               | Required | Default | Used by                 |
| ---------------------- | -------- | ------- | ----------------------- |
| `DATABASE_URL`         | yes      | —       | repositories            |
| `JWT_SECRET`           | yes      | —       | `TokenService`          |
| `JWT_ACCESS_TTL`       | no       | `15m`   | `TokenService`          |
| `AVATAR_PROVIDER_URL`  | yes      | —       | `ProfileService`        |
| `AVATAR_PROVIDER_KEY`  | yes      | —       | `ProfileService`        |
| `PROFILE_CACHE_TTL`    | no       | `60`    | `ProfileService` cache  |
| `USER_ID_HEADER`       | no       | —       | local development only  |
| `LOG_LEVEL`            | no       | `info`  | everything              |

## USER_ID_HEADER

When `USER_ID_HEADER` is set, `AuthMiddleware` trusts the named header instead
of verifying a JWT. This exists to make local development easy and **must never
be set in staging or production**: any caller could then read any `/me`.

## Profile cache

`PROFILE_CACHE_TTL` controls the in-process cache inside `ProfileService`. Set
it to `0` while debugging `GET /me` so every request re-reads `profiles`.
