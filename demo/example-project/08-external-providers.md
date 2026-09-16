# External providers

## Avatar provider

`ProfileService` is the only component that talks to the external avatar
provider. The client lives in `src/clients/AvatarProviderClient.ts`.

- Base URL comes from `AVATAR_PROVIDER_URL`.
- Authentication uses `AVATAR_PROVIDER_KEY`.
- Timeout is 2 seconds; failures are swallowed and retried by the nightly job.

Nothing else in the service may call the provider. In particular `UserService`
must not: a slow provider would then block `GET /me`.

## Mail provider

`SessionController` triggers verification mails through `acme-notify` over a
queue. There is no synchronous HTTP call.

## Database

PostgreSQL 15, reached through `DATABASE_URL`. Connection pooling is handled by
PgBouncer in transaction mode, so session-level `SET` statements are forbidden.
