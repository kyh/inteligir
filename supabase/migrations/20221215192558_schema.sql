create extension if not exists vector with schema public;

create type subscription_status as ENUM (
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused'
);

create type model_type as ENUM (
  'gpt-3.5-turbo',
  'gpt-4'
);

create type project_role as ENUM (
  'owner',
  'admin',
  'member'
);

create type message_sender_role as ENUM (
  'user',
  'system',
  'assistant'
);

create type source_type as ENUM (
  'github', 
  'website', 
  'file-upload',
  'api-upload'
);


create table users (
  id uuid references auth.users not null primary key,
  photo_url text,
  display_name text,
  onboarded bool not null,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id text not null primary key,
  price_id text not null,
  status subscription_status not null,
  cancel_at_period_end bool not null,
  currency text,
  interval text,
  interval_count int,
  created_at timestamptz,
  period_starts_at timestamptz,
  period_ends_at timestamptz,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz
);

create table organizations (
  id bigint generated always as identity primary key,
  name text not null,
  logo_url text,
  created_at timestamptz not null default now()
);

create table organizations_subscriptions (
  organization_id bigint not null references public.organizations (id) on delete cascade,
  subscription_id text unique references public.subscriptions (id) on delete set null,
  customer_id text not null unique,
  primary key (organization_id)
);

create table organizations_plans_thresholds (
  organization_id bigint not null references public.organizations (id) on delete cascade,
  remaining_tokens int not null,
  max_projects int not null,
  max_members int not null,
  primary key (organization_id)
);

create table memberships (
  id bigint generated always as identity primary key,
  user_id uuid references public.users,
  organization_id bigint not null references public.organizations,
  role int not null,
  invited_email text,
  code text,
  created_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

create table projects (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations on delete
  cascade,
  name text not null,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table projects_memberships (
  project_id bigint not null references public.projects on delete cascade,
  membership_id bigint not null references public.memberships on delete cascade,
  role project_role not null,
  primary key (project_id, membership_id)
);

create table models (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations on delete
  cascade,
  model model_type not null default 'gpt-3.5-turbo',
  name text not null,
  instruction text not null,
  temperature float not null default 0.5,
  max_tokens int not null default 256,
  top_p float not null default 1,
  frequency_penalty float not null default 0,
  presence_penalty float not null default 0,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table chats (
  id bigint generated always as identity primary key,
  name text not null,
  project_id bigint not null references public.projects on delete cascade,
  model_id bigint not null references public.models,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table messages (
  id bigint generated always as identity primary key,
  chat_id bigint not null references public.chats on delete cascade,
  content text not null,
  sender message_sender_role not null,
  created_at timestamptz not null default now ()
);

create table sources (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects on delete cascade,
  type source_type not null,
  data jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table domains (
  id bigint generated always as identity primary key,
  url text not null unique,
  project_id bigint not null references public.projects on delete cascade,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table tokens (
  id bigint generated always as identity primary key,
  url text not null unique,
  project_id bigint not null references public.projects on delete cascade,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table files (
  id bigint generated always as identity primary key,
  path text not null,
  meta jsonb,
  checksum text,
  source_id bigint references public.sources on delete cascade not null,
  project_id bigint not null references public.projects on delete cascade,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table file_sections (
  id bigint generated always as identity primary key,
  files_id bigint not null references public.files on delete cascade,
  content text,
  token_count int,
  embedding vector(1536)
);

insert into storage.buckets (id, name, PUBLIC) values ('logos', 'logos', true);

insert into storage.buckets (id, name, PUBLIC) values ('avatars', 'avatars', true);

alter table organizations enable row level security;

alter table users enable row level security;

alter table memberships enable row level security;

alter table subscriptions enable row level security;

alter table organizations_subscriptions enable row level security;

alter table projects enable row level security;

alter table projects_memberships enable row level security;

alter table chats enable row level security;

alter table messages enable row level security;

alter table models enable row level security;

alter table organizations_plans_thresholds enable row level security;

create or replace function create_new_organization (org_name text, user_id
uuid, create_user bool default true, tokens int default 0, max_projects int default 1, max_members int default 2)
  returns bigint
  language PLPGSQL
  security definer
  as $$
declare
  organization bigint;
begin
  insert into organizations ("name")
    values (org_name)
  returning
    id into organization;

  insert into organizations_plans_thresholds (organization_id,
  remaining_tokens, max_projects, max_members)
    values (organization, tokens, max_projects, max_members);

  if create_user then
    insert into users (id, onboarded)
      values (user_id, true);
  end if;
  insert into memberships (user_id, organization_id, role)
    values (user_id, organization, 2);
  return organization;
end;
$$;

create or replace function accept_invite_to_organization (invite_code text, invite_user_id uuid)
  returns json
  language PLPGSQL
  security definer
  as $$
declare
  organization bigint;
  membership bigint;
begin
  if not exists(select 1 from users where id = invite_user_id) then
    insert into users (id, onboarded)
      values (invite_user_id, true);
  end if;

  update
    memberships
  set
    user_id = invite_user_id,
    code = null,
    invited_email = null
  where
    code = invite_code
  returning
    id,
    organization_id into membership,
    organization;
  return json_build_object('organization', organization, 'membership', membership);
end;
$$;

create or replace function get_organizations_for_authenticated_user ()
  returns setof bigint
  language SQL
  security definer
  set search_path = PUBLIC stable
  as $$
  select
    organization_id
  from
    memberships
  where
    user_id = auth.uid ()
$$;

create or replace function get_projects_for_authenticated_user ()
  returns setof bigint
  language SQL
  security definer
  set search_path = PUBLIC stable
  as $$
  select
    project_id
  from
    projects_memberships
  JOIN memberships ON memberships.id = projects_memberships.membership_id
  where
    memberships.user_id = auth.uid ()
$$;

create or replace function is_project_owner (id bigint) returns boolean
  language SQL
  security definer
  set search_path = PUBLIC stable
  as $$
  select exists(
  select
    1
  from
    projects_memberships
  JOIN memberships ON memberships.id = projects_memberships.membership_id
  where
    memberships.user_id = auth.uid ()
    and projects_memberships.project_id = id
    and projects_memberships.role = 'owner'
  )
$$;

create or replace function can_create_project (org_id bigint) returns boolean
    language SQL
    security definer
    set search_path = PUBLIC stable
    as $$
    select exists (
        select
            1
        from
            organizations_plans_thresholds
        JOIN memberships ON memberships.organization_id =
        organizations_plans_thresholds.organization_id
        where
            memberships.user_id = auth.uid ()
            and organizations_plans_thresholds.organization_id = org_id
            and organizations_plans_thresholds.max_projects >
            (select count(*) from projects where organization_id = org_id)
    )
$$;

create or replace function can_invite_member (org_id bigint) returns boolean
    language SQL
    security definer
    set search_path = PUBLIC stable
    as $$
      select exists (
        select
              1
          from
              organizations_plans_thresholds
          JOIN memberships ON memberships.organization_id =
          organizations_plans_thresholds.organization_id
          where
              memberships.user_id = auth.uid ()
              and organizations_plans_thresholds.organization_id = org_id
              and organizations_plans_thresholds.max_members >
              (select count(*) from memberships where memberships.organization_id =
               id and memberships.code is null)
    )
$$;

create or replace function create_new_project (
    project_name text,
    user_uuid uuid,
    organization bigint
)
  returns bigint
  language PLPGSQL
  security definer
  as $$
declare
  project bigint;
  membership bigint;
begin
  if not can_create_project(organization) then
    raise exception 'cannot create project';
  end if;

  select id into membership from memberships where memberships.user_id =
  user_uuid and memberships.organization_id = organization;

  insert into projects ("name", "organization_id")
    values (project_name, organization)
  returning
    id into project;

  insert into projects_memberships (membership_id, project_id, role)
    values (membership, project, 'owner');

  return project;
end;
$$;

create or replace function get_role_for_authenticated_user (org_id bigint)
  returns int
  language PLPGSQL
  as $$
declare
  current_user_role int;
begin
  select
    role
  from
    memberships
  where
    user_id = auth.uid ()
    and memberships.organization_id = org_id into current_user_role;
  return current_user_role;
end;
$$;

create or replace function get_role_for_user (membership_id bigint)
  returns int
  language PLPGSQL
  as $$
declare
  current_user_role int;
begin
  select
    role
  from
    memberships
  where
    id = membership_id
  limit 1 into current_user_role;
  return current_user_role;
end;
$$;

create or replace function current_user_is_member_of_organization (organization_id bigint)
  returns bool
  language PLPGSQL
  as $$
begin
  return (organization_id in (
      select
        get_organizations_for_authenticated_user ()));
end;
$$;

create or replace function can_update_user_role (organization_id bigint, membership_id bigint)
  returns bool
  language PLPGSQL
  as $$
declare
  current_user_role int;
begin
  select
    get_role_for_authenticated_user (organization_id) into current_user_role;
  return current_user_role > get_role_for_user (membership_id);
end;
$$;

create or replace function transfer_organization (org_id bigint, target_user_membership_id bigint)
  returns void
  security definer
  language PLPGSQL
  as $$
declare
  current_user_role int;
  current_user_membership_id int;
begin
  select id, role from memberships where user_id = auth.uid() into current_user_membership_id, current_user_role;

  if current_user_role != 2 then
    raise exception 'Only owners can transfer organizations';
  end if;

  if current_user_membership_id = target_user_membership_id then
    raise exception 'Cannot transfer organization to yourself';
  end if;

  update
    memberships
  set
    role = 2
  where
    id = target_user_membership_id;
  update
    memberships
  set
    role = 1
  where
    user_id = auth.uid ()
    and organization_id = org_id;
end;
$$;

create policy "Users can update data to only their records" on users
  for update
    using (auth.uid () = users.id)
    with check (auth.uid () = users.id);

create policy "Users can read the public data of users belonging to the same
  organization" on users
  for select
    using (exists (
      select
        1
      from
        memberships
      where
        organization_id in (
          select
            get_organizations_for_authenticated_user ())));

create policy "Organizations can only be selectable by the members of the
  organization" on organizations
  for select
    using (id in (
      select
        organization_id
      from
        memberships
      where
        auth.uid () = memberships.user_id));

create policy "Organizations can only be updated by the members of the
  organization" on organizations
  for update
    using (id in (
      select
        organization_id
      from
        memberships
      where
        auth.uid () = memberships.user_id))
      with check (id in (
        select
          organization_id
        from
          memberships
        where
          auth.uid () = memberships.user_id));

create policy "Memberships can only be read by members that belong to the
  organization" on memberships
  for select
    using (current_user_is_member_of_organization (organization_id));

create policy "Pending memberships can be read by members assigned to one" on memberships
  for select
    using (
        auth.email() = memberships.invited_email
        and memberships.code is not null
    );

create policy "Organizations can be read by invited members to that organization" on organizations
  for select
    using (
        exists (
            select 1 from memberships
            where organizations.id = memberships.organization_id
            and memberships.invited_email = auth.email()
            and memberships.code is not null
        )
    );

create policy "Memberships can be created by members that belong to the
  organization" on memberships
  for insert
    with check (current_user_is_member_of_organization (organization_id) and
    can_invite_member(organization_id));

create policy "Memberships can only be updated if the user's role who updates
  the role is greater" on memberships
  for update
    using (can_update_user_role (organization_id, id));

create policy "Memberships can only be deleted if the user's role who updates
  the role is greater" on memberships
  for delete
    using (can_update_user_role (organization_id, id));

create policy "Subscriptions can only be selectable by members that belong to
  the organization" on subscriptions
  for select
    using (exists (
      select
        1
      from
        memberships
        join organizations_subscriptions on organizations_subscriptions.organization_id = memberships.organization_id
      where
        memberships.organization_id = organizations_subscriptions.organization_id and subscriptions.id = organizations_subscriptions.subscription_id and memberships.user_id = auth.uid ()));

create policy "Users can read subscriptions if they belong to the organization" on organizations_subscriptions
  for select
    using (exists (
      select
        1
      from
        memberships
      where
        user_id = auth.uid () and organization_id = memberships.organization_id));

create policy "Logos can be read and written by users that belong to the
  organization" on storage.objects
  for all
    using (bucket_id = 'logos'
      and (replace(storage.filename (name), concat('.', storage.extension (name)), '')::int) in (
        select
          get_organizations_for_authenticated_user ()))
        with check (bucket_id = 'logos'
        and (replace(storage.filename (name), concat('.', storage.extension (name)), '')::int) in (
          select
            get_organizations_for_authenticated_user ()));

create policy "Avatars can be read and written only by the user that owns the
  avatar" on storage.objects
  for all
    using (bucket_id = 'avatars'
      and (replace(storage.filename (name), concat('.', storage.extension (name)), '')::uuid) = auth.uid ())
      with check (bucket_id = 'avatars'
      and (replace(storage.filename (name), concat('.', storage.extension (name)), '')::uuid) = auth.uid ());

create policy "Chats can be read and written by users that belong to the
  project" on chats
  for all
    using (project_id in (
      select
        get_projects_for_authenticated_user ()))
      with check (project_id in (
        select
          get_projects_for_authenticated_user ()));

create policy "Models can be read and written by users that belong to the
  organization" on models
  for all
    using (organization_id in (
      select
        get_organizations_for_authenticated_user ()))
      with check (organization_id in (
        select
          get_organizations_for_authenticated_user ()));

create policy "Messages can be read and written by users that belong to the
project" on messages
  for all
    using (chat_id in (
      select
        id
      from
        chats
      where
        project_id in (
          select
            get_projects_for_authenticated_user ())))
      with check (chat_id in (
        select
          id
        from
          chats
        where
          project_id in (
            select
              get_projects_for_authenticated_user ())));

create policy "Workspaces can be read by users that belong to the
  project" on projects
  for select
    using (id in (
      select
        get_projects_for_authenticated_user ()));

create policy "Workspaces can be updated by users that belong to the
  project" on projects
  for update
    using (id in (
      select
        get_projects_for_authenticated_user ()))
      with check (id in (
        select
          get_projects_for_authenticated_user ()));

create policy "Workspaces can be deleted only by their owners" on projects
  for delete
      using (
        is_project_owner (id)
      );

create policy "Workspaces memberships can be read by users that
belong to the Workspace" on projects_memberships
for select
  using (project_id in (
    select
      get_projects_for_authenticated_user ()));

create policy "Organization members can read the thresholds belong to their
organization" on organizations_plans_thresholds
for select
  using (organization_id in (
    select
      get_organizations_for_authenticated_user ()));