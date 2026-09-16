# Data model

## users

| Column           | Type        | Notes                              |
| ---------------- | ----------- | ---------------------------------- |
| `id`             | `text`      | primary key, `usr_` prefix         |
| `email`          | `text`      | unique, lowercased on write        |
| `email_verified` | `boolean`   | default `false`                    |
| `password_hash`  | `text`      | Argon2id                           |
| `created_at`     | `timestamp` |                                    |
| `updated_at`     | `timestamp` |                                    |

Written only by `UserRepository`.

## profiles

| Column         | Type        | Notes                                    |
| -------------- | ----------- | ---------------------------------------- |
| `id`           | `text`      | primary key, `prf_` prefix               |
| `user_id`      | `text`      | **unique**, foreign key to `users.id`    |
| `handle`       | `text`      | unique, lowercase, 3–30 characters       |
| `display_name` | `text`      |                                          |
| `avatar_url`   | `text`      | nullable                                 |
| `updated_at`   | `timestamp` |                                          |

Written only by `ProfileRepository`.

### The uniqueness constraint on profiles.user_id

`profiles.user_id` must be unique. Before migration `0042` the constraint was
missing, and a small number of accounts ended up with two profile rows. When
that happens `ProfileRepository.findByUserId()` returns whichever row the
database scans first, so `GET /me` can answer with a display name and avatar
that belong to an older, orphaned profile.

Migration `0042_profiles_user_id_unique.sql` adds the constraint and keeps the
most recently updated row.

## sessions

| Column               | Type        | Notes                       |
| -------------------- | ----------- | --------------------------- |
| `id`                 | `text`      | the `sid` JWT claim         |
| `user_id`            | `text`      | foreign key to `users.id`   |
| `refresh_token_hash` | `text`      | SHA-256                     |
| `revoked_at`         | `timestamp` | nullable                    |
