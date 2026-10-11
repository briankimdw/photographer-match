-- Booking galleries: originals in Storage, a Postgres job queue, and the
-- processed (watermarked) previews.
--
-- Flow: the backend (as the provider, under RLS) uploads each original to
-- gallery-originals and inserts gallery_uploads + gallery_photos; a trigger
-- queues one gallery_jobs row per photo. The worker (python -m worker, service
-- role) claims jobs, renders preview + thumbnail into gallery-previews, stores
-- camera EXIF on the photo and GPS in gallery_photo_locations, then completes
-- or fails the job. When a batch has nothing left in flight, the client gets
-- one chat message.
--
-- Who sees what:
--   provider  every photo of their bookings, their own objects in both buckets
--   client    ready photos + previews while delivered/completed,
--             originals only once completed
--   others    nothing; gallery_jobs is service-role only
--
-- Object paths: {provider user id}/{booking_id}/{photo_id}.{ext}

-- ---------------------------------------------------------------------------
-- Buckets (private: everything goes through signed URLs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('gallery-originals', 'gallery-originals', false, 52428800, null),
  ('gallery-previews', 'gallery-previews', false, 15728640, array['image/jpeg']);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create type public.gallery_photo_status as enum ('queued', 'processing', 'ready', 'failed');
create type public.gallery_job_status as enum ('queued', 'running', 'done', 'failed');

-- One upload request (batch). notified_at: the client got the batch's chat message.
create table public.gallery_uploads (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id),
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  photo_count integer not null check (photo_count between 1 and 100),
  notified_at timestamptz,
  created_at  timestamptz not null default now()
);

create index gallery_uploads_booking_idx on public.gallery_uploads (booking_id);
create index gallery_uploads_provider_idx on public.gallery_uploads (provider_id);
create index gallery_uploads_uploaded_by_idx on public.gallery_uploads (uploaded_by);

-- One photo. exif holds camera fields only; GPS lives in gallery_photo_locations.
create table public.gallery_photos (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  upload_id     uuid not null references public.gallery_uploads (id) on delete cascade,
  provider_id   uuid not null references public.providers (id),
  position      integer not null default 0 check (position >= 0),
  filename      text not null default '',
  content_type  text not null default '',
  size_bytes    bigint not null check (size_bytes > 0),
  original_path text not null unique,
  preview_path  text,
  thumb_path    text,
  width         integer,
  height        integer,
  exif          jsonb not null default '{}'::jsonb,
  status        public.gallery_photo_status not null default 'queued',
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index gallery_photos_booking_idx on public.gallery_photos (booking_id, created_at, position);
create index gallery_photos_upload_idx on public.gallery_photos (upload_id, status);
create index gallery_photos_provider_idx on public.gallery_photos (provider_id);
create index gallery_photos_preview_path_idx on public.gallery_photos (preview_path) where preview_path is not null;
create index gallery_photos_thumb_path_idx on public.gallery_photos (thumb_path) where thumb_path is not null;

create trigger gallery_photos_updated_at
  before update on public.gallery_photos
  for each row execute function extensions.moddatetime (updated_at);

-- The queue: one job per photo.
create table public.gallery_jobs (
  id           uuid primary key default gen_random_uuid(),
  photo_id     uuid not null unique references public.gallery_photos (id) on delete cascade,
  status       public.gallery_job_status not null default 'queued',
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index gallery_jobs_status_idx on public.gallery_jobs (status, run_after);

create trigger gallery_jobs_updated_at
  before update on public.gallery_jobs
  for each row execute function extensions.moddatetime (updated_at);

-- Where each photo was taken (from its EXIF GPS), one row per photo with GPS.
-- Same geography type as bookings.location, for later distance checks.
create table public.gallery_photo_locations (
  photo_id   uuid primary key references public.gallery_photos (id) on delete cascade,
  lat        double precision not null check (lat between -90 and 90),
  lon        double precision not null check (lon between -180 and 180),
  alt_m      double precision,
  location   extensions.geography(point, 4326) not null,
  created_at timestamptz not null default now()
);

create index gallery_photo_locations_location_idx on public.gallery_photo_locations using gist (location);

-- ---------------------------------------------------------------------------
-- RLS helpers ("upload statuses" = confirmed, in_progress, delivered)
-- ---------------------------------------------------------------------------

-- The booking belongs to this provider and its gallery can still change.
create function public.gallery_booking_open(p_booking_id uuid, p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and b.provider_id = p_provider_id
      and b.status in ('confirmed', 'in_progress', 'delivered')
  );
$$;

-- The upload batch belongs to the same booking and provider.
create function public.gallery_upload_matches(p_upload_id uuid, p_booking_id uuid, p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gallery_uploads u
    where u.id = p_upload_id and u.booking_id = p_booking_id and u.provider_id = p_provider_id
  );
$$;

-- The current user is the booking's client and may see previews (delivered or
-- completed) or, with p_originals, the originals (completed only).
create function public.is_gallery_client(p_booking_id uuid, p_originals boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and b.client_id = (select auth.uid())
      and (b.status = 'completed' or (not p_originals and b.status = 'delivered'))
  );
$$;

-- The current user owns the photo's provider listing.
create function public.owns_gallery_photo(p_photo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gallery_photos p
    where p.id = p_photo_id and public.owns_provider(p.provider_id)
  );
$$;

revoke execute on function public.gallery_booking_open(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.gallery_upload_matches(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.is_gallery_client(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.owns_gallery_photo(uuid) from public, anon, authenticated;
grant execute on function public.gallery_booking_open(uuid, uuid) to authenticated;
grant execute on function public.gallery_upload_matches(uuid, uuid, uuid) to authenticated;
grant execute on function public.is_gallery_client(uuid, boolean) to authenticated;
grant execute on function public.owns_gallery_photo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.gallery_uploads enable row level security;

create policy "Providers see their gallery uploads"
  on public.gallery_uploads for select
  to authenticated
  using ((select public.owns_provider(provider_id)));

create policy "Providers start gallery uploads on open bookings"
  on public.gallery_uploads for insert
  to authenticated
  with check (
    (select public.owns_provider(provider_id))
    and public.gallery_booking_open(booking_id, provider_id)
    and uploaded_by = (select auth.uid())
  );

-- Used by the backend to undo a failed upload (photo rows cascade).
create policy "Providers delete their gallery uploads"
  on public.gallery_uploads for delete
  to authenticated
  using ((select public.owns_provider(provider_id)));

revoke all on public.gallery_uploads from anon;
revoke insert, update on public.gallery_uploads from authenticated;
grant insert (id, booking_id, provider_id, uploaded_by, photo_count) on public.gallery_uploads to authenticated;

alter table public.gallery_photos enable row level security;

create policy "Providers and delivered clients see gallery photos"
  on public.gallery_photos for select
  to authenticated
  using (
    (select public.owns_provider(provider_id))
    or (status = 'ready' and public.is_gallery_client(booking_id, false))
  );

create policy "Providers add photos to open bookings"
  on public.gallery_photos for insert
  to authenticated
  with check (
    (select public.owns_provider(provider_id))
    and public.gallery_booking_open(booking_id, provider_id)
    and public.gallery_upload_matches(upload_id, booking_id, provider_id)
    and original_path like (select auth.uid())::text || '/' || booking_id::text || '/' || id::text || '.%'
  );

-- A completed (or otherwise closed) gallery can't shrink.
create policy "Providers delete photos while the booking is open"
  on public.gallery_photos for delete
  to authenticated
  using (
    (select public.owns_provider(provider_id))
    and public.gallery_booking_open(booking_id, provider_id)
  );

-- Status, previews and metadata are written only by the worker functions.
revoke all on public.gallery_photos from anon;
revoke insert, update on public.gallery_photos from authenticated;
grant insert (id, booking_id, upload_id, provider_id, position, filename, content_type, size_bytes, original_path)
  on public.gallery_photos to authenticated;

alter table public.gallery_photo_locations enable row level security;

create policy "Providers and admins see photo locations"
  on public.gallery_photo_locations for select
  to authenticated
  using ((select public.owns_gallery_photo(photo_id)) or (select public.is_admin()));

-- Written only by complete_gallery_job, so a provider can't set or change a location.
revoke all on public.gallery_photo_locations from anon;
revoke insert, update, delete, truncate on public.gallery_photo_locations from authenticated;

-- The queue is service-role only.
alter table public.gallery_jobs enable row level security;
revoke all on public.gallery_jobs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Batch message: once nothing in an upload is queued/processing and at least
-- one photo is ready, post one chat message (as the provider) to the booking
-- conversation. notified_at makes it at most once per batch.
-- ---------------------------------------------------------------------------
create function public.gallery_check_batch(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ready integer;
  v_booking uuid;
  v_status public.booking_status;
  v_sender uuid;
  v_conversation uuid;
  v_body text;
begin
  if p_upload_id is null then
    return;
  end if;
  if exists (
    select 1 from public.gallery_photos p
    where p.upload_id = p_upload_id and p.status in ('queued', 'processing')
  ) then
    return;
  end if;
  select count(*) into v_ready
  from public.gallery_photos p
  where p.upload_id = p_upload_id and p.status = 'ready';
  if v_ready = 0 then
    return;
  end if;

  -- Outside any exception block: a blocked message must not undo this.
  update public.gallery_uploads u
  set notified_at = now()
  where u.id = p_upload_id and u.notified_at is null
  returning u.booking_id into v_booking;
  if v_booking is null then
    return;
  end if;

  select b.status, pr.profile_id into v_status, v_sender
  from public.bookings b
  join public.providers pr on pr.id = b.provider_id
  where b.id = v_booking;
  select c.id into v_conversation from public.conversations c where c.booking_id = v_booking;
  if v_conversation is null or v_sender is null then
    return;
  end if;

  if v_status in ('delivered', 'completed') then
    v_body := case when v_ready = 1
      then '1 new photo is ready in your gallery. Open the delivery page to view it.'
      else format('%s new photos are ready in your gallery. Open the delivery page to view them.', v_ready)
    end;
  else
    v_body := case when v_ready = 1
      then '1 photo was added to your gallery. You''ll be able to view it once the booking is marked delivered.'
      else format('%s photos were added to your gallery. You''ll be able to view them once the booking is marked delivered.', v_ready)
    end;
  end if;

  begin
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_sender, v_body);
  exception when insufficient_privilege then
    -- Blocked users: no message, but the batch stays notified.
    null;
  end;
end;
$$;

revoke execute on function public.gallery_check_batch(uuid) from public, anon, authenticated;

-- One job per new photo.
create function public.gallery_photos_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.gallery_jobs (photo_id) values (new.id);
  return null;
end;
$$;

revoke execute on function public.gallery_photos_enqueue() from public, anon, authenticated;

create trigger gallery_photos_enqueue
  after insert on public.gallery_photos
  for each row execute function public.gallery_photos_enqueue();

-- Deleting the last unfinished photo of a batch can complete it. Cascades from
-- a deleted upload or booking skip this (never a message, never an error).
create function public.gallery_photos_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.gallery_uploads u
    join public.bookings b on b.id = u.booking_id
    where u.id = old.upload_id
  ) then
    perform public.gallery_check_batch(old.upload_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.gallery_photos_after_delete() from public, anon, authenticated;

create trigger gallery_photos_after_delete
  after delete on public.gallery_photos
  for each row execute function public.gallery_photos_after_delete();

-- ---------------------------------------------------------------------------
-- Queue functions (worker, service role only)
-- ---------------------------------------------------------------------------

-- Claim the oldest runnable job (0 or 1 rows). Jobs stuck in 'running' for
-- 10 minutes (crashed worker) are reclaimed, or failed once out of attempts.
create function public.claim_gallery_job()
returns table (job_id uuid, photo_id uuid, attempts integer, original_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_stale record;
  v_job public.gallery_jobs;
  v_upload uuid;
begin
  for v_stale in
    update public.gallery_jobs j
    set status = 'failed', locked_at = null, last_error = 'Processing timed out'
    where j.status = 'running'
      and j.locked_at < now() - interval '10 minutes'
      and j.attempts >= j.max_attempts
    returning j.photo_id
  loop
    update public.gallery_photos p
    set status = 'failed', error = 'Processing timed out'
    where p.id = v_stale.photo_id
    returning p.upload_id into v_upload;
    perform public.gallery_check_batch(v_upload);
  end loop;

  select j.* into v_job
  from public.gallery_jobs j
  where (j.status = 'queued' and j.run_after <= now())
     or (j.status = 'running' and j.locked_at < now() - interval '10 minutes' and j.attempts < j.max_attempts)
  order by j.created_at, j.id
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;

  update public.gallery_jobs j
  set status = 'running', attempts = j.attempts + 1, locked_at = now()
  where j.id = v_job.id;
  update public.gallery_photos p
  set status = 'processing'
  where p.id = v_job.photo_id;

  return query
    select v_job.id, v_job.photo_id, v_job.attempts + 1, p.original_path
    from public.gallery_photos p
    where p.id = v_job.photo_id;
end;
$$;

-- Finish a running job. False only when the job (and so the photo) no longer
-- exists, so the worker removes the previews it just uploaded.
create function public.complete_gallery_job(
  p_job_id uuid,
  p_preview_path text,
  p_thumb_path text,
  p_width integer,
  p_height integer,
  p_exif jsonb,
  p_gps jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gallery_jobs;
  v_upload uuid;
  v_lat double precision;
  v_lon double precision;
begin
  select j.* into v_job from public.gallery_jobs j where j.id = p_job_id for update;
  if not found then
    return false;
  end if;
  if v_job.status <> 'running' then
    return true;
  end if;

  update public.gallery_jobs j
  set status = 'done', locked_at = null, last_error = null
  where j.id = p_job_id;
  update public.gallery_photos p
  set status = 'ready',
      preview_path = p_preview_path,
      thumb_path = p_thumb_path,
      width = p_width,
      height = p_height,
      exif = coalesce(p_exif, '{}'::jsonb),
      error = null
  where p.id = v_job.photo_id
  returning p.upload_id into v_upload;

  if p_gps is not null and jsonb_typeof(p_gps) = 'object' then
    v_lat := (p_gps ->> 'lat')::double precision;
    v_lon := (p_gps ->> 'lon')::double precision;
    if v_lat is not null and v_lon is not null then
      insert into public.gallery_photo_locations (photo_id, lat, lon, alt_m, location)
      values (
        v_job.photo_id,
        v_lat,
        v_lon,
        (p_gps ->> 'alt_m')::double precision,
        extensions.st_setsrid(extensions.st_makepoint(v_lon, v_lat), 4326)::extensions.geography
      )
      on conflict (photo_id) do update
      set lat = excluded.lat, lon = excluded.lon, alt_m = excluded.alt_m, location = excluded.location;
    end if;
  end if;

  perform public.gallery_check_batch(v_upload);
  return true;
end;
$$;

-- Record a failed attempt: retry with backoff (30 s, then 2 min) unless it's
-- permanent or out of attempts, in which case the photo is failed.
create function public.fail_gallery_job(p_job_id uuid, p_error text, p_permanent boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gallery_jobs;
  v_error text := left(coalesce(p_error, ''), 500);
  v_upload uuid;
begin
  select j.* into v_job from public.gallery_jobs j where j.id = p_job_id for update;
  if not found or v_job.status <> 'running' then
    return;
  end if;

  if not coalesce(p_permanent, false) and v_job.attempts < v_job.max_attempts then
    update public.gallery_jobs j
    set status = 'queued',
        locked_at = null,
        last_error = v_error,
        run_after = now() + case when v_job.attempts <= 1 then interval '30 seconds' else interval '2 minutes' end
    where j.id = p_job_id;
    update public.gallery_photos p set status = 'queued' where p.id = v_job.photo_id;
  else
    update public.gallery_jobs j
    set status = 'failed', locked_at = null, last_error = v_error
    where j.id = p_job_id;
    update public.gallery_photos p
    set status = 'failed', error = v_error
    where p.id = v_job.photo_id
    returning p.upload_id into v_upload;
    perform public.gallery_check_batch(v_upload);
  end if;
end;
$$;

revoke execute on function public.claim_gallery_job() from public, anon, authenticated;
revoke execute on function public.complete_gallery_job(uuid, text, text, integer, integer, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_gallery_job(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_gallery_job() to service_role;
grant execute on function public.complete_gallery_job(uuid, text, text, integer, integer, jsonb, jsonb) to service_role;
grant execute on function public.fail_gallery_job(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Retry (provider, from the app): put a failed photo back in the queue with
-- fresh attempts. Allowed in any booking status; notified_at is untouched.
-- ---------------------------------------------------------------------------
create function public.retry_gallery_photo(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.gallery_photos;
begin
  select p.* into v_photo from public.gallery_photos p where p.id = p_photo_id for update;
  if not found or not public.owns_provider(v_photo.provider_id) then
    raise exception 'Photo not found' using errcode = 'insufficient_privilege';
  end if;
  if v_photo.status <> 'failed' then
    raise exception 'Only failed photos can be retried';
  end if;

  insert into public.gallery_jobs (photo_id) values (p_photo_id)
  on conflict (photo_id) do update
  set status = 'queued', attempts = 0, run_after = now(), locked_at = null, last_error = null;
  update public.gallery_photos p set status = 'queued', error = null where p.id = p_photo_id;
end;
$$;

revoke execute on function public.retry_gallery_photo(uuid) from public, anon, authenticated;
grant execute on function public.retry_gallery_photo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage policies for the two gallery buckets (existing policies untouched).
-- ---------------------------------------------------------------------------

-- Read: the provider's own objects; the client's previews of ready photos while
-- delivered/completed; the client's originals of ready photos once completed.
create function public.can_read_gallery_object(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((storage.foldername(p_name))[1] = (select auth.uid())::text, false)
    or (p_bucket = 'gallery-previews' and exists (
      select 1 from public.gallery_photos p
      join public.bookings b on b.id = p.booking_id
      where (p.preview_path = p_name or p.thumb_path = p_name)
        and p.status = 'ready'
        and b.client_id = (select auth.uid())
        and b.status in ('delivered', 'completed')
    ))
    or (p_bucket = 'gallery-originals' and exists (
      select 1 from public.gallery_photos p
      join public.bookings b on b.id = p.booking_id
      where p.original_path = p_name
        and p.status = 'ready'
        and b.client_id = (select auth.uid())
        and b.status = 'completed'
    ));
$$;

-- Delete: the provider's own objects, unless a photo of a closed booking
-- (completed, ...) still references them.
create function public.can_delete_gallery_object(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_bucket in ('gallery-originals', 'gallery-previews')
    and coalesce((storage.foldername(p_name))[1] = (select auth.uid())::text, false)
    and not exists (
      select 1 from public.gallery_photos p
      join public.bookings b on b.id = p.booking_id
      where (p.original_path = p_name or p.preview_path = p_name or p.thumb_path = p_name)
        and b.status not in ('confirmed', 'in_progress', 'delivered')
    );
$$;

revoke execute on function public.can_read_gallery_object(text, text) from public, anon, authenticated;
revoke execute on function public.can_delete_gallery_object(text, text) from public, anon, authenticated;
grant execute on function public.can_read_gallery_object(text, text) to authenticated;
grant execute on function public.can_delete_gallery_object(text, text) to authenticated;

create policy "Providers upload gallery originals to their folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'gallery-originals'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Gallery parties read gallery objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('gallery-originals', 'gallery-previews')
    and public.can_read_gallery_object(bucket_id, name)
  );

create policy "Providers delete gallery objects of open bookings"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('gallery-originals', 'gallery-previews')
    and public.can_delete_gallery_object(bucket_id, name)
  );
