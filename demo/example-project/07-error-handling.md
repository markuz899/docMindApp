# Error handling

## Error envelope

Every error response uses the same envelope:

```json
{ "error": { "code": "PROFILE_NOT_FOUND", "message": "..." } }
```

## Status codes

| Status     | When                                                      |
| ---------- | --------------------------------------------------------- |
| `HTTP 400` | payload validation failed                                  |
| `HTTP 401` | missing, malformed or expired JWT                          |
| `HTTP 403` | valid token without the required scope                     |
| `HTTP 404` | the account or profile does not exist                      |
| `HTTP 409` | handle already taken                                       |
| `HTTP 500` | unhandled exception — always paired with a logged trace id |

## Known failure modes

### Stale or wrong data on GET /me

`GET /me` returns a merged DTO. When the payload looks wrong the cause is
almost always in the merge, not in the token:

- A duplicated `profiles.user_id` row (see `06-data-model.md`) makes
  `ProfileService.getByUserId()` return the wrong profile.
- A cached profile in `ProfileService` that was not invalidated after
  `PATCH /me`. The cache key is `profile:{user_id}` with a 60 second TTL.
- A client sending a token for a different environment: the `sub` claim then
  points at an id that exists in both databases with different owners.

`UserService.getCurrentUser()` logs `user_id`, `profile_id` and the cache hit
flag at debug level — that log line is the fastest way to tell the three cases
apart.

### Silent nulls

If `ProfileRepository.findByUserId()` returns nothing, `UserService` fills the
display fields with `null` instead of failing. The response is then a valid
`200` with an empty `displayName`, which reads like corrupted data.

## NullPointerException in the nightly job

The reconciliation job dereferences `profile.avatarUrl` without a null check
when an account has never uploaded an avatar. Tracked as `IDENT-118`.
