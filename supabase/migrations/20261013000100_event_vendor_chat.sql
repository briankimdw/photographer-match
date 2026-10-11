-- Event vendor chat: one coordination chat per event for its booked vendors and planners.
--
-- * A conversation of kind 'event_vendors' (at most one per event), separate from the
--   planners' own event chat (kind 'event'), which vendors never see.
-- * It opens by itself once 2 or more vendors (providers) have an accepted-or-later
--   booking for the event, and then stays, even if vendors drop out later.
-- * Members follow the bookings: the event's planners (owner + co-planners) plus the
--   profile behind every active vendor. A vendor is active while it has an eligible
--   booking on the event and the owner hasn't removed it (event_vendor_removals).
-- * Short notes ("DJ Nova joined the vendor chat") are ordinary messages sent as the
--   event's owner, whoever triggered the change.
-- * Read-only 14 days after the event ends, or right away when the event is cancelled.
--
-- Messages are never deleted here: a vendor who leaves keeps their messages in the
-- chat but loses access to it. Depends on 20261011000100_event_groups.sql and on
-- 20261013000000_event_vendor_chat_kind.sql (the new kind). Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Tables and index
-- ---------------------------------------------------------------------------

-- Vendors the owner took out of the vendor chat (their booking is untouched).
create table if not exists public.event_vendor_removals (
  event_id    uuid not null references public.events (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  removed_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  removed_at  timestamptz not null default now(),
  primary key (event_id, provider_id)
);

create index if not exists event_vendor_removals_provider_idx on public.event_vendor_removals (provider_id);
create index if not exists event_vendor_removals_removed_by_idx on public.event_vendor_removals (removed_by);

alter table public.event_vendor_removals enable row level security;

drop policy if exists "Planners see removed vendors" on public.event_vendor_removals;
create policy "Planners see removed vendors"
  on public.event_vendor_removals for select
  to authenticated
  using ((select public.is_event_member(event_id)));

-- Written only by remove_event_vendor / readd_event_vendor.
revoke all on public.event_vendor_removals from anon;
revoke insert, update, delete on public.event_vendor_removals from authenticated;

-- One vendor chat per event.
create unique index if not exists conversations_one_vendor_chat_per_event
  on public.conversations (event_id) where kind = 'event_vendors';

-- ---------------------------------------------------------------------------
-- 2. Internal helpers
-- ---------------------------------------------------------------------------

-- Booking statuses that put a vendor in the chat (accepted or later, disputes included).
create or replace function public.counts_for_vendor_chat(p_status public.booking_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('accepted', 'confirmed', 'in_progress', 'delivered', 'completed', 'disputed');
$$;
revoke execute on function public.counts_for_vendor_chat(public.booking_status) from public, anon, authenticated;

-- The event's vendor chat id (or null).
create or replace function public.event_vendor_chat_id(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.conversations c where c.event_id = p_event_id and c.kind = 'event_vendors' limit 1;
$$;
revoke execute on function public.event_vendor_chat_id(uuid) from public, anon, authenticated;

-- Does this provider have an eligible booking on the event?
create or replace function public.event_vendor_eligible(p_event_id uuid, p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.event_id = p_event_id and b.provider_id = p_provider_id and public.counts_for_vendor_chat(b.status)
  );
$$;
revoke execute on function public.event_vendor_eligible(uuid, uuid) from public, anon, authenticated;

-- Active vendors: an eligible booking on the event and not removed by the owner.
create or replace function public.event_active_vendors(p_event_id uuid)
returns table (provider_id uuid, profile_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, p.profile_id, p.display_name
  from public.bookings b
  join public.providers p on p.id = b.provider_id
  where b.event_id = p_event_id
    and public.counts_for_vendor_chat(b.status)
    and not exists (select 1 from public.event_vendor_removals x where x.event_id = p_event_id and x.provider_id = b.provider_id);
$$;
revoke execute on function public.event_active_vendors(uuid) from public, anon, authenticated;

-- When the chat turns read-only by date: 14 days after the event ends (null without dates).
create or replace function public.event_vendor_chat_closes_at(p_event_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(e.ends_at, e.starts_at) + interval '14 days' from public.events e where e.id = p_event_id;
$$;
revoke execute on function public.event_vendor_chat_closes_at(uuid) from public, anon, authenticated;

-- Read-only: the event is cancelled, or its closing date has passed.
create or replace function public.event_vendor_chat_closed(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select e.status = 'cancelled'
      or (coalesce(e.ends_at, e.starts_at) is not null and now() >= coalesce(e.ends_at, e.starts_at) + interval '14 days')
    from public.events e where e.id = p_event_id
  ), false);
$$;
revoke execute on function public.event_vendor_chat_closed(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sync: create the chat when due and keep its members in line
-- ---------------------------------------------------------------------------

-- Idempotent. p_reason picks the note for vendors taken out: 'removed' (by the owner)
-- or 'left' (their booking stopped counting). Returns the chat id, or null when there's
-- no chat (yet) or the event is gone.
create or replace function public.sync_event_vendor_chat(p_event_id uuid, p_reason text default 'left')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
  v_conversation uuid;
  v_created boolean := false;
  v_closed boolean;
  v_planners uuid[];
  v_vendors uuid[];
  v_name text;
  r record;
begin
  if p_event_id is null then
    return null;
  end if;
  -- One sync per event at a time (with the unique index, two can't both create a chat).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('event_vendor_chat:' || p_event_id::text));

  select e.owner_id, e.title into v_owner, v_title from public.events e where e.id = p_event_id;
  if not found then
    return null;  -- e.g. the event is being deleted
  end if;
  v_closed := public.event_vendor_chat_closed(p_event_id);
  v_conversation := public.event_vendor_chat_id(p_event_id);

  if v_conversation is null then
    if v_closed or (select count(*) from public.event_active_vendors(p_event_id)) < 2 then
      return null;
    end if;
    insert into public.conversations (kind, event_id, title)
    values ('event_vendors', p_event_id, left('Vendors · ' || v_title, 80))
    on conflict do nothing
    returning id into v_conversation;
    if v_conversation is null then
      v_conversation := public.event_vendor_chat_id(p_event_id);
    else
      v_created := true;
    end if;
  end if;

  select coalesce(array_agg(m.profile_id), '{}') into v_planners from public.event_members m where m.event_id = p_event_id;
  select coalesce(array_agg(distinct a.profile_id), '{}') into v_vendors from public.event_active_vendors(p_event_id) a;

  -- Out: anyone who is neither planning nor an active vendor (a planner who is also a vendor stays).
  for r in
    select cm.profile_id from public.conversation_members cm
    where cm.conversation_id = v_conversation
      and not (cm.profile_id = any (v_planners || v_vendors))
  loop
    delete from public.conversation_members where conversation_id = v_conversation and profile_id = r.profile_id;
    if not v_closed then
      select p.display_name into v_name
      from public.providers p
      left join public.event_vendor_removals x on x.event_id = p_event_id and x.provider_id = p.id
      where p.profile_id = r.profile_id
        and exists (select 1 from public.bookings b where b.event_id = p_event_id and b.provider_id = p.id)
      order by (x.provider_id is not null) = (p_reason = 'removed') desc, p.display_name
      limit 1;
      if found then
        insert into public.messages (conversation_id, sender_id, body)
        values (v_conversation, v_owner, left(case when p_reason = 'removed'
          then format('%s was removed from the vendor chat', v_name)
          else format('%s left the vendor chat', v_name) end, 4000));
      end if;
    end if;
  end loop;

  -- In: planners and active vendors who aren't members yet.
  for r in
    select distinct w.profile_id
    from unnest(v_planners || v_vendors) w(profile_id)
    where not exists (select 1 from public.conversation_members cm where cm.conversation_id = v_conversation and cm.profile_id = w.profile_id)
  loop
    insert into public.conversation_members (conversation_id, profile_id)
    values (v_conversation, r.profile_id)
    on conflict do nothing;
    if not v_created and not v_closed and not (r.profile_id = any (v_planners)) then
      select a.name into v_name from public.event_active_vendors(p_event_id) a where a.profile_id = r.profile_id order by a.name limit 1;
      if found then
        insert into public.messages (conversation_id, sender_id, body)
        values (v_conversation, v_owner, left(format('%s joined the vendor chat', v_name), 4000));
      end if;
    end if;
  end loop;

  if v_created then
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_owner, left(format('Vendor chat opened for %s', v_title), 4000));
  end if;
  return v_conversation;
end;
$$;
revoke execute on function public.sync_event_vendor_chat(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Triggers (they never make the original change fail)
-- ---------------------------------------------------------------------------

-- A booking's status or event changes: sync the old and the new event.
create or replace function public.bookings_sync_vendor_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = new.status and old.event_id is not distinct from new.event_id then
      return new;
    end if;
  end if;
  begin
    if new.event_id is not null then
      perform public.sync_event_vendor_chat(new.event_id);
    end if;
    if tg_op = 'UPDATE' then
      if old.event_id is not null and old.event_id is distinct from new.event_id then
        perform public.sync_event_vendor_chat(old.event_id);
      end if;
    end if;
  exception when others then
    raise warning 'event vendor chat sync failed: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.bookings_sync_vendor_chat() from public, anon, authenticated;

drop trigger if exists bookings_sync_vendor_chat on public.bookings;
create trigger bookings_sync_vendor_chat
  after insert or update of status, event_id on public.bookings
  for each row execute function public.bookings_sync_vendor_chat();

-- Planners join and leave the vendor chat with the event.
create or replace function public.event_members_sync_vendor_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    begin
      perform public.sync_event_vendor_chat(new.event_id);
    exception when others then
      raise warning 'event vendor chat sync failed: %', sqlerrm;
    end;
    return new;
  end if;
  begin
    perform public.sync_event_vendor_chat(old.event_id);
  exception when others then
    raise warning 'event vendor chat sync failed: %', sqlerrm;
  end;
  return old;
end;
$$;
revoke execute on function public.event_members_sync_vendor_chat() from public, anon, authenticated;

drop trigger if exists event_members_sync_vendor_chat on public.event_members;
create trigger event_members_sync_vendor_chat
  after insert or delete on public.event_members
  for each row execute function public.event_members_sync_vendor_chat();

-- Renaming the event renames its vendor chat.
create or replace function public.events_sync_vendor_chat_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    update public.conversations set title = left('Vendors · ' || new.title, 80) where event_id = new.id and kind = 'event_vendors';
  exception when others then
    raise warning 'event vendor chat sync failed: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.events_sync_vendor_chat_title() from public, anon, authenticated;

drop trigger if exists events_sync_vendor_chat_title on public.events;
create trigger events_sync_vendor_chat_title
  after update of title on public.events
  for each row when (old.title is distinct from new.title)
  execute function public.events_sync_vendor_chat_title();

-- A closed vendor chat takes no new messages.
create or replace function public.messages_vendor_chat_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  select c.event_id into v_event from public.conversations c where c.id = new.conversation_id and c.kind = 'event_vendors';
  if found and public.event_vendor_chat_closed(v_event) then
    raise exception 'This vendor chat is closed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.messages_vendor_chat_open() from public, anon, authenticated;

drop trigger if exists messages_vendor_chat_open on public.messages;
create trigger messages_vendor_chat_open
  before insert on public.messages
  for each row execute function public.messages_vendor_chat_open();

-- ---------------------------------------------------------------------------
-- 5. Functions the app calls
-- ---------------------------------------------------------------------------

-- For planners: the vendor chat (if open yet), whether it's closed, and every vendor on the event.
create or replace function public.event_vendor_chat(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conversation uuid;
  v_owner uuid;
  v_vendors jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_event_member(p_event_id) then
    raise exception 'Event not found';
  end if;
  select e.owner_id into v_owner from public.events e where e.id = p_event_id;
  v_conversation := public.event_vendor_chat_id(p_event_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'provider_id', p.id,
           'name', p.display_name,
           'vertical', sc.slug,
           'booking_status', (
             select b.status from public.bookings b
             where b.event_id = p_event_id and b.provider_id = p.id
             order by public.counts_for_vendor_chat(b.status) desc, b.created_at desc
             limit 1),
           'in_chat', v_conversation is not null
             and x.provider_id is null
             and public.event_vendor_eligible(p_event_id, p.id)
             and exists (select 1 from public.conversation_members cm where cm.conversation_id = v_conversation and cm.profile_id = p.profile_id),
           'removed', x.provider_id is not null
         ) order by p.display_name), '[]'::jsonb)
    into v_vendors
  from (
    select b.provider_id from public.bookings b where b.event_id = p_event_id and public.counts_for_vendor_chat(b.status)
    union
    select r.provider_id from public.event_vendor_removals r where r.event_id = p_event_id
  ) ids
  join public.providers p on p.id = ids.provider_id
  left join public.service_categories sc on sc.id = p.vertical_id
  left join public.event_vendor_removals x on x.event_id = p_event_id and x.provider_id = p.id;

  return jsonb_build_object(
    'conversation_id', v_conversation,
    'closed', public.event_vendor_chat_closed(p_event_id),
    'closes_at', public.event_vendor_chat_closes_at(p_event_id),
    'is_owner', v_owner = v_uid,
    'vendors', v_vendors);
end;
$$;

-- The owner takes a vendor out of the vendor chat (their booking isn't affected).
create or replace function public.remove_event_vendor(p_event_id uuid, p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_event_member(p_event_id) then
    raise exception 'Event not found';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.owner_id = v_uid) then
    raise exception 'Only the event''s owner can remove vendors';
  end if;
  if not public.event_vendor_eligible(p_event_id, p_provider_id) then
    raise exception 'That vendor isn''t on this event';
  end if;
  insert into public.event_vendor_removals (event_id, provider_id, removed_by)
  values (p_event_id, p_provider_id, v_uid)
  on conflict do nothing;
  perform public.sync_event_vendor_chat(p_event_id, 'removed');
end;
$$;

-- The owner lets a removed vendor back in. True if they're in the chat now; false
-- when they no longer have an eligible booking for the event.
create or replace function public.readd_event_vendor(p_event_id uuid, p_provider_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conversation uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_event_member(p_event_id) then
    raise exception 'Event not found';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.owner_id = v_uid) then
    raise exception 'Only the event''s owner can remove vendors';
  end if;
  delete from public.event_vendor_removals where event_id = p_event_id and provider_id = p_provider_id;
  v_conversation := public.sync_event_vendor_chat(p_event_id);
  return v_conversation is not null
    and public.event_vendor_eligible(p_event_id, p_provider_id)
    and exists (
      select 1 from public.conversation_members cm
      join public.providers p on p.profile_id = cm.profile_id
      where cm.conversation_id = v_conversation and p.id = p_provider_id
    );
end;
$$;

-- For members of a vendor chat: its event, whether it's closed, and who's who
-- (current members plus everyone who has written in it).
create or replace function public.vendor_chat_info(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event uuid;
  v_title text;
  v_owner uuid;
  v_participants jsonb;
begin
  select c.event_id into v_event from public.conversations c where c.id = p_conversation_id and c.kind = 'event_vendors';
  if v_uid is null or v_event is null or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Chat not found';
  end if;
  select e.title, e.owner_id into v_title, v_owner from public.events e where e.id = v_event;

  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', people.profile_id,
           'role', case when pl.profile_id is not null then 'planner' when v.id is not null then 'vendor' else 'former_planner' end,
           'name', case when pl.profile_id is null and v.id is not null then v.display_name
                        else coalesce(nullif(trim(pr.display_name), ''), pr.username::text, 'Someone') end,
           'provider_id', case when pl.profile_id is null then v.id end,
           'active', exists (select 1 from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.profile_id = people.profile_id)
         )), '[]'::jsonb)
    into v_participants
  from (
    select cm.profile_id from public.conversation_members cm where cm.conversation_id = p_conversation_id
    union
    select m.sender_id from public.messages m where m.conversation_id = p_conversation_id
  ) people
  left join public.profiles pr on pr.id = people.profile_id
  left join public.event_members pl on pl.event_id = v_event and pl.profile_id = people.profile_id
  left join lateral (
    select p.id, p.display_name from public.providers p
    where p.profile_id = people.profile_id
      and exists (select 1 from public.bookings b where b.event_id = v_event and b.provider_id = p.id)
    order by p.display_name
    limit 1
  ) v on true;

  return jsonb_build_object(
    'event_id', v_event,
    'event_title', v_title,
    'closed', public.event_vendor_chat_closed(v_event),
    'closes_at', public.event_vendor_chat_closes_at(v_event),
    'is_planner', public.is_event_member(v_event),
    'is_owner', v_owner = v_uid,
    'participants', v_participants);
end;
$$;

-- The vendor chat of a booking's event, for the booking's client or vendor when
-- they're in it; otherwise null.
create or replace function public.vendor_chat_for_booking(p_booking_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.bookings b
  join public.conversations c on c.event_id = b.event_id and c.kind = 'event_vendors'
  where b.id = p_booking_id
    and (b.client_id = (select auth.uid())
         or exists (select 1 from public.providers p where p.id = b.provider_id and p.profile_id = (select auth.uid())))
    and exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.profile_id = (select auth.uid()))
  limit 1;
$$;

revoke execute on function public.event_vendor_chat(uuid) from public, anon;
revoke execute on function public.remove_event_vendor(uuid, uuid) from public, anon;
revoke execute on function public.readd_event_vendor(uuid, uuid) from public, anon;
revoke execute on function public.vendor_chat_info(uuid) from public, anon;
revoke execute on function public.vendor_chat_for_booking(uuid) from public, anon;
grant execute on function public.event_vendor_chat(uuid) to authenticated;
grant execute on function public.remove_event_vendor(uuid, uuid) to authenticated;
grant execute on function public.readd_event_vendor(uuid, uuid) to authenticated;
grant execute on function public.vendor_chat_info(uuid) to authenticated;
grant execute on function public.vendor_chat_for_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Backfill: events that already have 2+ vendors with eligible bookings get their chat.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select distinct b.event_id from public.bookings b
    where b.event_id is not null and public.counts_for_vendor_chat(b.status)
  loop
    perform public.sync_event_vendor_chat(r.event_id);
  end loop;
end $$;
