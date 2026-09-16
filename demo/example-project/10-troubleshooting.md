# Troubleshooting

## GET /me returns the wrong user's data

Work through this in order:

1. Decode the JWT and check the `sub` claim against the account you expect.
2. Check `USER_ID_HEADER` is unset in the environment you are testing.
3. Query `select * from profiles where user_id = '<sub>'` and confirm exactly
   one row comes back. Two rows means migration `0042` has not been applied.
4. Set `PROFILE_CACHE_TTL=0` and retry: if the payload becomes correct, the
   cache in `ProfileService` was stale after a `PATCH /me`.
5. Read the `UserService.getCurrentUser()` debug log line and compare
   `profile_id` with the row from step 3.

## GET /me returns 401 with a fresh token

Check the clock skew between the issuing host and the verifying host. The
`exp` claim is verified with no leeway.

## HTTP 500 on PATCH /me

Usually a handle collision that escaped validation and hit the unique index on
`profiles.handle`. It should be a `409`; tracked as `IDENT-124`.

## Login succeeds but every later request is 401

The client is sending the refresh token instead of the access token. Only the
access token is a JWT.
