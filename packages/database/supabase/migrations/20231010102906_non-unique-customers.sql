alter table "public"."organizations_subscriptions" drop constraint "organizations_subscriptions_customer_id_key";

drop index if exists "public"."organizations_subscriptions_customer_id_key";