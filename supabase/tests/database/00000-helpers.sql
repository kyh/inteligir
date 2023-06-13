/**
Most of this package is based on the work of JumpBase
 */
-- Enable pgTAP if it's not already enabled
create extension if not exists pgtap with schema extensions;

-- We want to store all of this in the tests schema to keep it
-- separate from any application data
create schema if not exists tests;

-- anon and authenticated should have access to tests schema
grant USAGE on schema tests to anon, authenticated;

-- Don't allow public to execute any functions in the tests schema
alter default PRIVILEGES in schema tests revoke execute on FUNCTIONS from PUBLIC;

-- Grant execute to anon and authenticated for testing purposes
alter default PRIVILEGES in schema tests grant execute on FUNCTIONS to anon, authenticated;


/**
 * ### tests.create_supabase_user(identifier text, email text, phone text)
 *
 * Creates a new user in the `auth.users` table.
 * You can recall a user's info by using `tests.get_supabase_user(identifier text)`.
 *
 * Parameters:
 * - `identifier` - A unique identifier for the user. We recommend you keep it memorable like "test_owner" or "test_member"
 * - `email` - (Optional) The email address of the user
 * - `phone` - (Optional) The phone number of the user
 *
 * Returns:
 * - `user_id` - The UUID of the user in the `auth.users` table
 *
 * Example:
 * ```sql
 *   SELECT tests.create_supabase_user('test_owner');
 *   SELECT tests.create_supabase_user('test_member', 'member@test.com', '555-555-5555');
 * ```
 */
create or replace function tests.create_supabase_user (identifier text, email text default null, phone text default null)
  returns uuid
  security definer
  set search_path = auth, pg_temp
  as $$
declare
  user_id uuid;
begin
  -- create the user
  user_id := extensions.uuid_generate_v4 ();
  insert into auth.users (id, email, phone, raw_user_meta_data)
    values (user_id, coalesce(email, concat(user_id, '@test.com')), phone, json_build_object('test_identifier', identifier))
  returning
    id into user_id;
  return user_id;
end;
$$
language PLPGSQL;


/**
 * ### tests.create_db_user(user_id uuid)
 * Writes to DB the user created with `tests.create_supabase_user`.
 */
create or replace function tests.create_db_user (user_id uuid)
  returns void
  as $$
begin
  insert into public.users (id, onboarded)
    values (user_id, true);
end;
$$
language PLPGSQL;


/**
 * ### tests.get_supabase_user(identifier text)
 *
 * Returns the user info for a user created with `tests.create_supabase_user`.
 *
 * Parameters:
 * - `identifier` - The unique identifier for the user
 *
 * Returns:
 * - `user_id` - The UUID of the user in the `auth.users` table
 *
 * Example:
 * ```sql
 *   SELECT posts where posts.user_id = tests.get_supabase_user('test_owner') -> 'id';
 * ```
 */
create or replace function tests.get_supabase_user (identifier text)
  returns json
  security definer
  set search_path = auth, pg_temp
  as $$
declare
  supabase_user json;
begin
  select
    json_build_object('id', id, 'email', email, 'phone', phone) into supabase_user
  from
    auth.users
  where
    raw_user_meta_data ->> 'test_identifier' = identifier
  limit 1;
  if supabase_user is null or supabase_user -> 'id' is null then
    raise exception 'User with identifier % not found', identifier;
  end if;
  return supabase_user;
end;
$$
language PLPGSQL;


/**
 * ### tests.get_supabase_uid(identifier text)
 *
 * Returns the user UUID for a user created with `tests.create_supabase_user`.
 *
 * Parameters:
 * - `identifier` - The unique identifier for the user
 *
 * Returns:
 * - `user_id` - The UUID of the user in the `auth.users` table
 *
 * Example:
 * ```sql
 *   SELECT posts where posts.user_id = tests.get_supabase_uid('test_owner') -> 'id';
 * ```
 */
create or replace function tests.get_supabase_uid (identifier text)
  returns uuid
  security definer
  set search_path = auth, pg_temp
  as $$
declare
  supabase_user uuid;
begin
  select
    id into supabase_user
  from
    auth.users
  where
    raw_user_meta_data ->> 'test_identifier' = identifier
  limit 1;
  if supabase_user is null then
    raise exception 'User with identifier % not found', identifier;
  end if;
  return supabase_user;
end;
$$
language PLPGSQL;


/**
 * ### tests.authenticate_as(identifier text)
 *   Authenticates as a user created with `tests.create_supabase_user`.
 *
 * Parameters:
 * - `identifier` - The unique identifier for the user
 *
 * Returns:
 * - `void`
 *
 * Example:
 * ```sql
 *   SELECT tests.create_supabase_user('test_owner');
 *   SELECT tests.authenticate_as('test_owner');
 * ```
 */
create or replace function tests.authenticate_as (identifier text)
  returns void
  as $$
declare
  user_data json;
  original_auth_data text;
begin
  -- store the request.jwt.claims in a variable in case we need it
  original_auth_data := current_setting('request.jwt.claims', true);
  user_data := tests.get_supabase_user (identifier);
  if user_data is null or user_data ->> 'id' is null then
    raise exception 'User with identifier % not found', identifier;
  end if;
  perform
    set_config('role', 'authenticated', true);
  perform
    set_config('request.jwt.claims', json_build_object('sub', user_data ->> 'id', 'email', user_data ->> 'email', 'phone', user_data ->> 'phone')::text, true);
exception
  -- revert back to original auth data
  when others then
    set local role authenticated;
  set local "request.jwt.claims" to original_auth_data;
  raise;
end
$$
language PLPGSQL;


/**
 * ### tests.clear_authentication()
 *   Clears out the authentication and sets role to anon
 *
 * Returns:
 * - `void`
 *
 * Example:
 * ```sql
 *   SELECT tests.create_supabase_user('test_owner');
 *   SELECT tests.authenticate_as('test_owner');
 *   SELECT tests.clear_authentication();
 * ```
 */
create or replace function tests.clear_authentication ()
  returns void
  as $$
begin
  perform
    set_config('role', 'anon', true);
  perform
    set_config('request.jwt.claims', null, true);
end
$$
language PLPGSQL;


/**
 * ### tests.rls_enabled(testing_schema text)
 * pgTAP function to check if RLS is enabled on all tables in a provided schema
 *
 * Parameters:
 * - schema_name text - The name of the schema to check
 *
 * Example:
 * ```sql
 *   BEGIN;
 *       select plan(1);
 *       select tests.rls_enabled('public');
 *       SELECT * FROM finish();
 *   ROLLBACK;
 * ```
 */
create or replace function tests.rls_enabled (testing_schema text)
  returns text
  as $$
  select
    is ((
        select
          count(pc.relname)::integer
        from
          pg_class pc
          join pg_namespace pn on pn.oid = pc.relnamespace
            and pn.nspname = rls_enabled.testing_schema
          join pg_type pt on pt.oid = pc.reltype
        where
          relrowsecurity = false), 0, 'All tables in the' || testing_schema || ' schema should have row level security enabled');

$$
language SQL;


/**
 * ### tests.rls_enabled(testing_schema text, testing_table text)
 * pgTAP function to check if RLS is enabled on a specific table
 *
 * Parameters:
 * - schema_name text - The name of the schema to check
 * - testing_table text - The name of the table to check
 *
 * Example:
 * ```sql
 *    BEGIN;
 *        select plan(1);
 *        select tests.rls_enabled('public', 'accounts');
 *        SELECT * FROM finish();
 *    ROLLBACK;
 * ```
 */
create or replace function tests.rls_enabled (testing_schema text, testing_table text)
  returns text
  as $$
  select
    is ((
        select
          count(*)::integer
        from
          pg_class pc
          join pg_namespace pn on pn.oid = pc.relnamespace
            and pn.nspname = rls_enabled.testing_schema
            and pc.relname = rls_enabled.testing_table
          join pg_type pt on pt.oid = pc.reltype
        where
          relrowsecurity = true), 1, testing_table || 'table in the' || testing_schema || ' schema should have row level security enabled');

$$
language SQL;

create or replace function tests.get_organization_id (org_name text)
  returns bigint
  security definer
  set search_path = PUBLIC
  as $$
declare
  organization_id bigint;
begin
  select
    id into organization_id
  from
    organizations
  where
    name = org_name
  limit 1;
  return organization_id;
end;
$$
language PLPGSQL;

-- we have to run some tests to get this to pass as the first test file.
-- investigating options to make this better.  Maybe a dedicated test harness
-- but we dont' want these functions to always exist on the database.
begin;

select
  plan (7);

select
  function_returns ('tests', 'create_supabase_user', array['text', 'text', 'text'], 'uuid');

select
  function_returns ('tests', 'get_supabase_uid', array['text'], 'uuid');

select
  function_returns ('tests', 'get_supabase_user', array['text'], 'json');

select
  function_returns ('tests', 'authenticate_as', array['text'], 'void');

select
  function_returns ('tests', 'clear_authentication', array[null], 'void');

select
  function_returns ('tests', 'rls_enabled', array['text', 'text'], 'text');

select
  function_returns ('tests', 'rls_enabled', array['text'], 'text');

select
  *
from
  finish ();

rollback;

