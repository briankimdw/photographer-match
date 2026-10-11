-- Test for booking galleries (20261012000000_booking_gallery_processing.sql). Always rolls back.
-- Run in the SQL editor and read the error message: every line should end in "ok".
--
-- The worker steps (claim/complete/fail) run as the editor's own role, like the
-- service-role worker. now() is fixed inside one transaction, so "time passing"
-- for backoff is simulated by moving run_after back. Jobs that aren't part of
-- the test are parked (run_after/locked_at pushed out) so claim only sees ours;
-- that change is rolled back with everything else.
do $$
declare
  v uuid := gen_random_uuid();   -- Vic: the booking's vendor
  w uuid := gen_random_uuid();   -- Wes: another vendor
  c uuid := gen_random_uuid();   -- Cat: the client
  s uuid := gen_random_uuid();   -- Sam: a stranger
  v_vertical uuid;
  v_pv uuid; v_pw uuid;
  v_bk uuid; v_bk2 uuid;
  v_conv uuid;
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  ph1 uuid := gen_random_uuid(); ph2 uuid := gen_random_uuid(); ph3 uuid := gen_random_uuid();
  ph4 uuid := gen_random_uuid(); ph5 uuid := gen_random_uuid(); ph6 uuid := gen_random_uuid();
  ph7 uuid := gen_random_uuid();
  v_claim record;
  v_ok boolean;
  v_lat double precision; v_lon double precision; v_alt double precision;
  v_wait interval;
  v_status text; v_status2 text;
  v_body text;
  n integer; m integer;
  r text := E'\n';
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (v, 'v.gallerytest@example.com', '{"full_name": "Vic Test"}', 'authenticated', 'authenticated'),
    (w, 'w.gallerytest@example.com', '{"full_name": "Wes Test"}', 'authenticated', 'authenticated'),
    (c, 'c.gallerytest@example.com', '{"full_name": "Cat Test"}', 'authenticated', 'authenticated'),
    (s, 's.gallerytest@example.com', '{"full_name": "Sam Test"}', 'authenticated', 'authenticated');
  select id into v_vertical from public.service_categories where kind = 'vertical' order by sort_order limit 1;
  insert into public.providers (profile_id, vertical_id, display_name, slug, status)
  values (v, v_vertical, 'Vic Photo', 'vic-photo-gallerytest', 'active') returning id into v_pv;
  insert into public.providers (profile_id, vertical_id, display_name, slug, status)
  values (w, v_vertical, 'Wes Photo', 'wes-photo-gallerytest', 'active') returning id into v_pw;
  insert into public.bookings (client_id, provider_id, status, time_range, timezone, total_cents, package_snapshot)
  values (c, v_pv, 'confirmed', tstzrange(now() + interval '30 days', now() + interval '30 days 4 hours'), 'America/Los_Angeles', 90000, '{"name": "Wedding"}')
  returning id into v_bk;
  insert into public.bookings (client_id, provider_id, status, time_range, timezone, total_cents, package_snapshot)
  values (c, v_pw, 'confirmed', tstzrange(now() + interval '40 days', now() + interval '40 days 4 hours'), 'America/Los_Angeles', 90000, '{"name": "Portraits"}')
  returning id into v_bk2;
  select id into v_conv from public.conversations where booking_id = v_bk;

  -- Park everyone else's jobs so claim only sees this test's.
  update public.gallery_jobs set run_after = now() + interval '1 day' where status = 'queued';
  update public.gallery_jobs set locked_at = now() where status = 'running';

  -- Vic uploads three photos (as the backend does, under RLS).
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.gallery_uploads (id, booking_id, provider_id, photo_count) values (u1, v_bk, v_pv, 3);
  insert into public.gallery_photos (id, booking_id, upload_id, provider_id, position, filename, content_type, size_bytes, original_path) values
    (ph1, v_bk, u1, v_pv, 0, 'a.jpg', 'image/jpeg', 10, v || '/' || v_bk || '/' || ph1 || '.jpg'),
    (ph2, v_bk, u1, v_pv, 1, 'b.jpg', 'image/jpeg', 10, v || '/' || v_bk || '/' || ph2 || '.jpg'),
    (ph3, v_bk, u1, v_pv, 2, 'c.heic', '', 10, v || '/' || v_bk || '/' || ph3 || '.heic');
  select count(*) into n from public.gallery_photos where booking_id = v_bk;
  r := r || format('01 provider sees all their photos (%s): %s', n, case when n = 3 then 'ok' else 'FAIL' end) || E'\n';

  begin
    insert into public.gallery_photos (id, booking_id, upload_id, provider_id, size_bytes, original_path)
    values (ph7, v_bk2, u1, v_pv, 10, v || '/' || v_bk2 || '/' || ph7 || '.jpg');
    r := r || '02 can''t add a photo to another vendor''s booking: FAIL' || E'\n';
  exception when others then
    r := r || '02 can''t add a photo to another vendor''s booking: ok' || E'\n';
  end;
  begin
    insert into public.gallery_photos (id, booking_id, upload_id, provider_id, size_bytes, original_path)
    values (ph7, v_bk, u1, v_pv, 10, w || '/' || v_bk || '/' || ph7 || '.jpg');
    r := r || '03 can''t add a photo outside their own folder: FAIL' || E'\n';
  exception when others then
    r := r || '03 can''t add a photo outside their own folder: ok' || E'\n';
  end;
  begin
    perform 1 from public.gallery_jobs;
    r := r || '04 authenticated can''t read gallery_jobs: FAIL' || E'\n';
  exception when insufficient_privilege then
    r := r || '04 authenticated can''t read gallery_jobs: ok' || E'\n';
  end;
  begin
    perform public.claim_gallery_job();
    r := r || '05 authenticated can''t call claim_gallery_job: FAIL' || E'\n';
  exception when insufficient_privilege then
    r := r || '05 authenticated can''t call claim_gallery_job: ok' || E'\n';
  end;
  begin
    insert into public.gallery_photo_locations (photo_id, lat, lon, location)
    values (ph1, 1, 1, extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326)::extensions.geography);
    r := r || '06 authenticated can''t insert locations: FAIL' || E'\n';
  exception when insufficient_privilege then
    r := r || '06 authenticated can''t insert locations: ok' || E'\n';
  end;
  begin
    update public.gallery_photo_locations set lat = 0;
    r := r || '07 authenticated can''t update locations: FAIL' || E'\n';
  exception when insufficient_privilege then
    r := r || '07 authenticated can''t update locations: ok' || E'\n';
  end;
  begin
    update public.gallery_photos set status = 'ready' where id = ph1;
    r := r || '08 authenticated can''t update photo status: FAIL' || E'\n';
  exception when insufficient_privilege then
    r := r || '08 authenticated can''t update photo status: ok' || E'\n';
  end;

  -- While confirmed the client sees nothing; a stranger never does.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.gallery_photos where booking_id = v_bk;
  r := r || format('09 client sees nothing while confirmed (%s): %s', n, case when n = 0 then 'ok' else 'FAIL' end) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  select count(*) into n from public.gallery_photos where booking_id = v_bk;
  r := r || format('10 stranger sees nothing (%s): %s', n, case when n = 0 then 'ok' else 'FAIL' end) || E'\n';

  -- Worker: one job per photo; process ph1 with GPS.
  reset role;
  select count(*) into n from public.gallery_jobs where photo_id in (ph1, ph2, ph3) and status = 'queued';
  r := r || format('11 one queued job per photo (%s): %s', n, case when n = 3 then 'ok' else 'FAIL' end) || E'\n';

  update public.gallery_jobs set run_after = now() + interval '1 day' where photo_id in (ph2, ph3);
  select * into v_claim from public.claim_gallery_job();
  select status::text into v_status from public.gallery_photos where id = ph1;
  r := r || format('12 claim returns the job (attempt 1) and marks the photo processing: %s',
    case when v_claim.photo_id = ph1 and v_claim.attempts = 1 and v_status = 'processing' then 'ok' else 'FAIL' end) || E'\n';
  v_ok := public.complete_gallery_job(v_claim.job_id, v || '/' || v_bk || '/' || ph1 || '_p.jpg', v || '/' || v_bk || '/' || ph1 || '_t.jpg',
    3000, 2000, '{"make": "Canon"}', '{"lat": 34.0259, "lon": -118.7798, "alt_m": 12.0}');
  select l.lat, l.lon, l.alt_m into v_lat, v_lon, v_alt from public.gallery_photo_locations l where l.photo_id = ph1;
  select count(*) into n from public.gallery_photo_locations l
  where l.photo_id = ph1
    and abs(extensions.st_y(l.location::extensions.geometry) - 34.0259) < 1e-6
    and abs(extensions.st_x(l.location::extensions.geometry) + 118.7798) < 1e-6;
  select p.status::text into v_status from public.gallery_photos p where p.id = ph1;
  r := r || format('13 complete with GPS: photo ready + one location row at the right point: %s',
    case when v_ok and v_status = 'ready' and n = 1 and v_lat = 34.0259 and v_lon = -118.7798 and v_alt = 12.0 then 'ok' else 'FAIL' end) || E'\n';
  select count(*) into n from public.messages where conversation_id = v_conv and sender_id = v;
  r := r || format('14 no message while the batch is still in flight (%s): %s', n, case when n = 0 then 'ok' else 'FAIL' end) || E'\n';

  -- ph2 without GPS.
  update public.gallery_jobs set run_after = now() where photo_id = ph2;
  select * into v_claim from public.claim_gallery_job();
  v_ok := public.complete_gallery_job(v_claim.job_id, v || '/' || v_bk || '/' || ph2 || '_p.jpg', v || '/' || v_bk || '/' || ph2 || '_t.jpg', 800, 600, '{}', null);
  select count(*) into n from public.gallery_photo_locations where photo_id = ph2;
  r := r || format('15 complete without GPS writes no location (%s): %s', n, case when v_claim.photo_id = ph2 and n = 0 then 'ok' else 'FAIL' end) || E'\n';

  -- ph3 fails three times.
  update public.gallery_jobs set run_after = now() where photo_id = ph3;
  select * into v_claim from public.claim_gallery_job();
  perform public.fail_gallery_job(v_claim.job_id, 'boom', false);
  select j.status::text, j.run_after - now() into v_status, v_wait from public.gallery_jobs j where j.photo_id = ph3;
  select p.status::text into v_status2 from public.gallery_photos p where p.id = ph3;
  r := r || format('16 first failure: queued again after 30 s: %s',
    case when v_claim.photo_id = ph3 and v_status = 'queued' and v_status2 = 'queued' and v_wait = interval '30 seconds' then 'ok' else 'FAIL' end) || E'\n';
  update public.gallery_jobs set run_after = now() where photo_id = ph3;
  select * into v_claim from public.claim_gallery_job();
  perform public.fail_gallery_job(v_claim.job_id, 'boom', false);
  select j.run_after - now() into v_wait from public.gallery_jobs j where j.photo_id = ph3;
  r := r || format('17 second failure: backoff 2 min: %s', case when v_claim.attempts = 2 and v_wait = interval '2 minutes' then 'ok' else 'FAIL' end) || E'\n';
  update public.gallery_jobs set run_after = now() where photo_id = ph3;
  select * into v_claim from public.claim_gallery_job();
  perform public.fail_gallery_job(v_claim.job_id, 'boom', false);
  select j.status::text into v_status from public.gallery_jobs j where j.photo_id = ph3;
  select p.status::text into v_status2 from public.gallery_photos p where p.id = ph3;
  r := r || format('18 third failure ends failed: %s',
    case when v_claim.attempts = 3 and v_status = 'failed' and v_status2 = 'failed' then 'ok' else 'FAIL' end) || E'\n';

  select count(*), max(body) into n, v_body from public.messages where conversation_id = v_conv and sender_id = v;
  r := r || format('19 exactly one batch message (%s, "%s"): %s', n, v_body,
    case when n = 1 and v_body like '2 photos were added to your gallery.%' then 'ok' else 'FAIL' end) || E'\n';

  -- A batch where everything fails sends nothing.
  insert into public.gallery_uploads (id, booking_id, provider_id, uploaded_by, photo_count) values (u2, v_bk, v_pv, v, 1);
  insert into public.gallery_photos (id, booking_id, upload_id, provider_id, size_bytes, original_path)
  values (ph4, v_bk, u2, v_pv, 10, v || '/' || v_bk || '/' || ph4 || '.jpg');
  select * into v_claim from public.claim_gallery_job();
  perform public.fail_gallery_job(v_claim.job_id, 'not an image', true);
  select count(*) into n from public.messages where conversation_id = v_conv and sender_id = v;
  select count(*) into m from public.gallery_uploads where id = u2 and notified_at is null;
  r := r || format('20 all-failed batch: permanent failure, no message: %s',
    case when v_claim.photo_id = ph4 and n = 1 and m = 1 then 'ok' else 'FAIL' end) || E'\n';

  -- Retry: refused for others, resets for the owner, then the batch can notify.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.retry_gallery_photo(ph4);
    r := r || '21 retry refused for a non-owner: FAIL' || E'\n';
  exception when insufficient_privilege then
    r := r || '21 retry refused for a non-owner: ok' || E'\n';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  begin
    perform public.retry_gallery_photo(ph1);
    r := r || '22 only failed photos can be retried: FAIL' || E'\n';
  exception when others then
    r := r || format('22 only failed photos can be retried: %s', case when sqlerrm = 'Only failed photos can be retried' then 'ok' else 'FAIL ' || sqlerrm end) || E'\n';
  end;
  perform public.retry_gallery_photo(ph4);
  reset role;
  select j.status::text, p.status::text into v_status, v_status2
  from public.gallery_jobs j join public.gallery_photos p on p.id = j.photo_id
  where j.photo_id = ph4 and j.attempts = 0 and j.last_error is null and p.error is null;
  r := r || format('23 retry resets the job and photo: %s', case when v_status = 'queued' and v_status2 = 'queued' then 'ok' else 'FAIL' end) || E'\n';
  select * into v_claim from public.claim_gallery_job();
  v_ok := public.complete_gallery_job(v_claim.job_id, v || '/' || v_bk || '/' || ph4 || '_p.jpg', v || '/' || v_bk || '/' || ph4 || '_t.jpg', 800, 600, '{}', null);
  select count(*) into n from public.messages where conversation_id = v_conv and sender_id = v and body like '1 photo was added to your gallery.%';
  r := r || format('24 the retried batch notifies once it has a ready photo: %s', case when n = 1 then 'ok' else 'FAIL' end) || E'\n';

  -- Delivered: the client sees ready photos and previews, not originals.
  update public.bookings set status = 'delivered', delivered_at = now() where id = v_bk;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.gallery_photos where booking_id = v_bk;
  select count(*) into m from public.gallery_photos where booking_id = v_bk and status <> 'ready';
  r := r || format('25 client sees only ready photos while delivered (%s): %s', n, case when n = 3 and m = 0 then 'ok' else 'FAIL' end) || E'\n';
  r := r || format('26 client can read previews while delivered: %s',
    case when public.can_read_gallery_object('gallery-previews', v || '/' || v_bk || '/' || ph1 || '_t.jpg')
          and public.can_read_gallery_object('gallery-previews', v || '/' || v_bk || '/' || ph1 || '_p.jpg') then 'ok' else 'FAIL' end) || E'\n';
  r := r || format('27 client can''t read originals while delivered: %s',
    case when not public.can_read_gallery_object('gallery-originals', v || '/' || v_bk || '/' || ph1 || '.jpg') then 'ok' else 'FAIL' end) || E'\n';
  r := r || format('28 client can''t read a failed photo''s objects: %s',
    case when not public.can_read_gallery_object('gallery-previews', v || '/' || v_bk || '/' || ph3 || '_p.jpg') then 'ok' else 'FAIL' end) || E'\n';
  select count(*) into n from public.gallery_photo_locations;
  r := r || format('29 client can''t read locations (%s): %s', n, case when n = 0 then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  select count(*) into n from public.gallery_photos where booking_id = v_bk;
  select count(*) into m from public.gallery_photo_locations where photo_id = ph1;
  r := r || format('30 stranger sees no photos or locations, can''t read previews: %s',
    case when n = 0 and m = 0 and not public.can_read_gallery_object('gallery-previews', v || '/' || v_bk || '/' || ph1 || '_p.jpg') then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  select count(*) into n from public.gallery_photos where booking_id = v_bk;
  select count(*) into m from public.gallery_photo_locations where photo_id = ph1;
  r := r || format('31 provider sees every photo and the location: %s', case when n = 4 and m = 1 then 'ok' else 'FAIL' end) || E'\n';
  r := r || format('32 provider may delete their objects while delivered: %s',
    case when public.can_delete_gallery_object('gallery-originals', v || '/' || v_bk || '/' || ph1 || '.jpg') then 'ok' else 'FAIL' end) || E'\n';

  -- Deleting the last unfinished photo of a batch with a ready photo sends the message.
  reset role;
  insert into public.gallery_uploads (id, booking_id, provider_id, uploaded_by, photo_count) values (u3, v_bk, v_pv, v, 2);
  insert into public.gallery_photos (id, booking_id, upload_id, provider_id, position, size_bytes, original_path) values
    (ph5, v_bk, u3, v_pv, 0, 10, v || '/' || v_bk || '/' || ph5 || '.jpg'),
    (ph6, v_bk, u3, v_pv, 1, 10, v || '/' || v_bk || '/' || ph6 || '.jpg');
  update public.gallery_jobs set run_after = now() + interval '1 day' where photo_id = ph6;
  select * into v_claim from public.claim_gallery_job();
  v_ok := public.complete_gallery_job(v_claim.job_id, v || '/' || v_bk || '/' || ph5 || '_p.jpg', v || '/' || v_bk || '/' || ph5 || '_t.jpg', 800, 600, '{}', null);
  select count(*) into n from public.messages where conversation_id = v_conv and sender_id = v and body like '1 new photo is ready%';
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.gallery_photos where id = ph6;
  reset role;
  select count(*) into m from public.messages where conversation_id = v_conv and sender_id = v and body like '1 new photo is ready%';
  r := r || format('33 deleting the last unfinished photo sends the batch message: %s',
    case when v_claim.photo_id = ph5 and n = 0 and m = 1 then 'ok' else 'FAIL' end) || E'\n';

  -- Completed: originals open to the client; the gallery can't shrink or grow.
  update public.bookings set status = 'completed', completed_at = now() where id = v_bk;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || format('34 client can read originals once completed: %s',
    case when public.can_read_gallery_object('gallery-originals', v || '/' || v_bk || '/' || ph1 || '.jpg') then 'ok' else 'FAIL' end) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  delete from public.gallery_photos where id = ph1;
  get diagnostics n = row_count;
  r := r || format('35 provider can''t delete a photo once completed (%s rows): %s', n, case when n = 0 then 'ok' else 'FAIL' end) || E'\n';
  r := r || format('36 provider can''t delete its objects once completed: %s',
    case when not public.can_delete_gallery_object('gallery-originals', v || '/' || v_bk || '/' || ph1 || '.jpg')
          and not public.can_delete_gallery_object('gallery-previews', v || '/' || v_bk || '/' || ph1 || '_p.jpg') then 'ok' else 'FAIL' end) || E'\n';
  begin
    insert into public.gallery_photos (id, booking_id, upload_id, provider_id, size_bytes, original_path)
    values (ph7, v_bk, u1, v_pv, 10, v || '/' || v_bk || '/' || ph7 || '.jpg');
    r := r || '37 can''t add a photo to a completed booking: FAIL' || E'\n';
  exception when others then
    r := r || '37 can''t add a photo to a completed booking: ok' || E'\n';
  end;
  reset role;

  raise exception 'GALLERY TEST RESULTS (rolled back):%', r;
end $$;
