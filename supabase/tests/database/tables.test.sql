begin;

select
  plan (4);

set LOCAL search_path = core, PUBLIC, extensions;

select
  has_table ('organizations');

select
  has_table ('memberships');

select
  has_table ('users');

select
  has_table ('subscriptions');

select
  *
from
  finish ();

rollback;

