# anyone-eat

## Supabase user profiles

Run [`supabase_profiles.sql`](./supabase_profiles.sql) once in the Supabase SQL Editor before deploying the profile-login version of the page.

The migration:

- creates the `profiles` table;
- merges duplicate browser-generated IDs that used the same username;
- makes usernames unique and case-insensitive;
- backfills profiles from existing check-ins;
- synchronizes profile name/avatar changes to all historical check-ins;
- enables the required RLS policies and Realtime publication.

This is intentionally a password-free shared app: anyone who knows a username can log in as that user.
