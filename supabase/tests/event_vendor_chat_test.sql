-- Test for the event vendor chat: opening, membership following bookings and planners,
-- owner removal / add back, isolation from the planning chat, info lookups, closing.
-- Always rolls back.
-- Run in the SQL editor and read the error message: every line should end in "ok".
do $$
declare
  a  uuid := gen_random_uuid();  -- Rosa: owns the event
  b  uuid := gen_random_uuid();  -- Ben: co-planner
  c  uuid := gen_random_uuid();  -- Cat: co-planner added later, then leaves
  d  uuid := gen_random_uuid();  -- Dan: stranger
  v1 uuid := gen_random_uuid();  -- DJ Nova's owner
  v2 uuid := gen_random_uuid();  -- Glasshouse's owner
  v3 uuid := gen_random_uuid();  -- the replacement DJ's owner
  v_vertical uuid;
  p1 uuid;
  p2 uuid;
  p3 uuid;
  bk1 uuid;
  bk2 uuid;
  bk3 uuid;
  v_event uuid;
  v_plan_chat uuid;
  v_chat uuid;
  v_res jsonb;
  v_ok boolean;
  v_id uuid;
  n integer;
  m integer;
  t text;
  r text := E'\n';
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (a,  'a.vctest@example.com',  '{"full_name": "Rosa Test"}', 'authenticated', 'authenticated'),
    (b,  'b.vctest@example.com',  '{"full_name": "Ben Test"}',  'authenticated', 'authenticated'),
    (c,  'c.vctest@example.com',  '{"full_name": "Cat Test"}',  'authenticated', 'authenticated'),
    (d,  'd.vctest@example.com',  '{"full_name": "Dan Test"}',  'authenticated', 'authenticated'),
    (v1, 'v1.vctest@example.com', '{"full_name": "Nova Owner"}', 'authenticated', 'authenticated'),
    (v2, 'v2.vctest@example.com', '{"full_name": "Glass Owner"}', 'authenticated', 'authenticated'),
    (v3, 'v3.vctest@example.com', '{"full_name": "Beat Owner"}', 'authenticated', 'authenticated');

  select id into v_vertical from public.service_categories where kind = 'vertical' order by sort_order limit 1;
  insert into public.providers (profile_id, vertical_id, display_name, slug, status)
  values (v1, v_vertical, 'DJ Nova Test', 'dj-nova-vctest', 'active') returning id into p1;
  insert into public.providers (profile_id, vertical_id, display_name, slug, status)
  values (v2, v_vertical, 'Glasshouse Test', 'glasshouse-vctest', 'active') returning id into p2;
  insert into public.providers (profile_id, vertical_id, display_name, slug, status)
  values (v3, v_vertical, 'Beat Box Test', 'beat-box-vctest', 'active') returning id into p3;

  -- Rosa creates the event with Ben planning, and puts DJ Nova on the board.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.create_event_with_chat('Rosa & Dev''s wedding', 'wedding', now() + interval '30 days', now() + interval '30 days 6 hours', 'Los Angeles', 120, 3000000, array[b]);
  v_event := (v_res ->> 'event_id')::uuid;
  v_plan_chat := (v_res ->> 'conversation_id')::uuid;
  perform public.add_event_candidate(v_event, p1, 'music', null);
  reset role;

  -- One accepted vendor: no chat yet.
  insert into public.bookings (client_id, provider_id, event_id, status, time_range, timezone, total_cents, package_snapshot)
  values (a, p1, v_event, 'accepted', tstzrange(now() + interval '30 days', now() + interval '30 days 4 hours'), 'America/Los_Angeles', 90000, '{"name": "Party set"}')
  returning id into bk1;
  select count(*) into n from public.conversations where event_id = v_event and kind = 'event_vendors';
  r := r || case when n = 0 then '01 one accepted vendor, no vendor chat yet: ok' || E'\n' else format('01 one accepted vendor, no vendor chat yet (%s): FAIL', n) || E'\n' end;

  -- The Glasshouse is requested, then accepts: the chat opens.
  insert into public.bookings (client_id, provider_id, event_id, status, time_range, timezone, total_cents, package_snapshot)
  values (a, p2, v_event, 'requested', tstzrange(now() + interval '30 days', now() + interval '30 days 8 hours'), 'America/Los_Angeles', 500000, '{"name": "Full day"}')
  returning id into bk2;
  select count(*) into n from public.conversations where event_id = v_event and kind = 'event_vendors';
  r := r || case when n = 0 then '02 a requested booking doesn''t count: ok' || E'\n' else format('02 a requested booking doesn''t count (%s): FAIL', n) || E'\n' end;
  update public.bookings set status = 'accepted' where id = bk2;
  select count(*), min(id::text)::uuid into n, v_chat from public.conversations where event_id = v_event and kind = 'event_vendors';
  select count(*) into m from public.conversations where id = v_chat and title = 'Vendors · Rosa & Dev''s wedding';
  r := r || case when n = 1 and m = 1 then '03 second acceptance opens exactly one vendor chat: ok' || E'\n' else format('03 second acceptance opens exactly one vendor chat (%s, %s): FAIL', n, m) || E'\n' end;
  select count(*) into n from public.conversation_members where conversation_id = v_chat and profile_id in (a, b, v1, v2);
  select count(*) into m from public.conversation_members where conversation_id = v_chat;
  r := r || case when n = 4 and m = 4 then '04 members are Rosa, Ben and both vendors: ok' || E'\n' else format('04 members are Rosa, Ben and both vendors (%s of %s): FAIL', n, m) || E'\n' end;
  select count(*) into n from public.messages where conversation_id = v_chat and sender_id = a and body = 'Vendor chat opened for Rosa & Dev''s wedding';
  select count(*) into m from public.messages where conversation_id = v_chat;
  r := r || case when n = 1 and m = 1 then '05 one "opened" note, sent as the owner: ok' || E'\n' else format('05 one "opened" note, sent as the owner (%s, %s): FAIL', n, m) || E'\n' end;

  -- DJ Nova sees the vendor chat and nothing of the planning.
  perform set_config('request.jwt.claims', json_build_object('sub', v1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.conversations where id = v_chat;
  r := r || case when n = 1 then '06 vendor sees the vendor chat: ok' || E'\n' else '06 vendor sees the vendor chat: FAIL' || E'\n' end;
  select count(*) into n from public.conversations where event_id = v_event and kind = 'event';
  select n + count(*) into n from public.messages where conversation_id = v_plan_chat;
  r := r || case when n = 0 then '07 vendor can''t see the planning chat: ok' || E'\n' else format('07 vendor can''t see the planning chat (%s): FAIL', n) || E'\n' end;
  select count(*) into n from public.events where id = v_event;
  r := r || case when n = 0 then '08 vendor can''t see the event row: ok' || E'\n' else '08 vendor can''t see the event row: FAIL' || E'\n' end;
  select count(*) into n from public.event_candidates where event_id = v_event;
  r := r || case when n = 0 then '09 vendor can''t see the candidate board: ok' || E'\n' else '09 vendor can''t see the candidate board: FAIL' || E'\n' end;
  begin
    perform public.event_vendor_chat(v_event);
    r := r || '10 vendor can''t call event_vendor_chat: FAIL' || E'\n';
  exception when others then
    r := r || '10 vendor can''t call event_vendor_chat: ok' || E'\n';
  end;
  insert into public.messages (conversation_id, body) values (v_chat, 'What time is curfew?');

  -- The Glasshouse reads it.
  perform set_config('request.jwt.claims', json_build_object('sub', v2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.messages where conversation_id = v_chat and body = 'What time is curfew?';
  r := r || case when n = 1 then '11 the other vendor reads the message: ok' || E'\n' else '11 the other vendor reads the message: FAIL' || E'\n' end;
  v_res := public.vendor_chat_info(v_chat);
  select count(*) into n from jsonb_array_elements(v_res -> 'participants') x
  where (x ->> 'profile_id')::uuid = a and x ->> 'role' = 'planner' and x ->> 'name' = 'Rosa Test';
  select n + count(*) into n from jsonb_array_elements(v_res -> 'participants') x
  where (x ->> 'profile_id')::uuid = v1 and x ->> 'role' = 'vendor' and x ->> 'name' = 'DJ Nova Test' and (x ->> 'provider_id')::uuid = p1;
  r := r || case when n = 2 and (v_res ->> 'is_planner')::boolean = false and (v_res ->> 'event_id')::uuid = v_event
    then '12 vendor_chat_info labels planners and vendors: ok' || E'\n' else format('12 vendor_chat_info labels planners and vendors (%s): FAIL', n) || E'\n' end;

  -- Ben (co-planner) sees the vendor list but can't remove anyone.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  v_res := public.event_vendor_chat(v_event);
  r := r || case when (v_res ->> 'conversation_id')::uuid = v_chat and jsonb_array_length(v_res -> 'vendors') = 2 and (v_res ->> 'is_owner')::boolean = false
    then '13 co-planner gets the vendor list: ok' || E'\n' else '13 co-planner gets the vendor list: FAIL' || E'\n' end;
  begin
    perform public.remove_event_vendor(v_event, p1);
    r := r || '14 co-planner can''t remove vendors: FAIL' || E'\n';
  exception when others then
    r := r || '14 co-planner can''t remove vendors: ok' || E'\n';
  end;

  -- Rosa removes DJ Nova.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.remove_event_vendor(v_event, p1);
  perform public.remove_event_vendor(v_event, p1); -- again: no-op
  select count(*) into n from public.conversation_members where conversation_id = v_chat and profile_id = v1;
  r := r || case when n = 0 then '15 removed vendor is out of the chat: ok' || E'\n' else '15 removed vendor is out of the chat: FAIL' || E'\n' end;
  select count(*) into n from public.messages where conversation_id = v_chat and sender_id = a and body = 'DJ Nova Test was removed from the vendor chat';
  r := r || case when n = 1 then '16 one "was removed" note: ok' || E'\n' else format('16 one "was removed" note (%s): FAIL', n) || E'\n' end;
  select status::text into t from public.bookings where id = bk1;
  r := r || case when t = 'accepted' then '17 removal leaves the booking alone: ok' || E'\n' else format('17 removal leaves the booking alone (%s): FAIL', t) || E'\n' end;
  select count(*) into n from public.messages where conversation_id = v_chat and sender_id = v1;
  r := r || case when n = 1 then '18 removed vendor''s message stays: ok' || E'\n' else '18 removed vendor''s message stays: FAIL' || E'\n' end;
  v_res := public.vendor_chat_info(v_chat);
  select count(*) into n from jsonb_array_elements(v_res -> 'participants') x
  where (x ->> 'profile_id')::uuid = v1 and (x ->> 'active')::boolean = false and x ->> 'role' = 'vendor';
  r := r || case when n = 1 and (v_res ->> 'is_owner')::boolean then '19 vendor_chat_info lists the removed vendor as inactive: ok' || E'\n' else '19 vendor_chat_info lists the removed vendor as inactive: FAIL' || E'\n' end;
  v_res := public.event_vendor_chat(v_event);
  select count(*) into n from jsonb_array_elements(v_res -> 'vendors') x
  where (x ->> 'provider_id')::uuid = p1 and (x ->> 'removed')::boolean and not (x ->> 'in_chat')::boolean and x ->> 'booking_status' = 'accepted';
  r := r || case when n = 1 then '20 event_vendor_chat shows the vendor as removed: ok' || E'\n' else '20 event_vendor_chat shows the vendor as removed: FAIL' || E'\n' end;

  -- DJ Nova has lost all access.
  perform set_config('request.jwt.claims', json_build_object('sub', v1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.messages where conversation_id = v_chat;
  select n + count(*) into n from public.conversations where id = v_chat;
  r := r || case when n = 0 then '21 removed vendor can''t read the chat: ok' || E'\n' else format('21 removed vendor can''t read the chat (%s): FAIL', n) || E'\n' end;
  begin
    insert into public.messages (conversation_id, body) values (v_chat, 'Still here?');
    r := r || '22 removed vendor can''t post: FAIL' || E'\n';
  exception when others then
    r := r || '22 removed vendor can''t post: ok' || E'\n';
  end;
  begin
    perform public.vendor_chat_info(v_chat);
    r := r || '23 removed vendor can''t call vendor_chat_info: FAIL' || E'\n';
  exception when others then
    r := r || '23 removed vendor can''t call vendor_chat_info: ok' || E'\n';
  end;
  v_id := public.vendor_chat_for_booking(bk1);
  r := r || case when v_id is null then '24 vendor_chat_for_booking is null for the removed vendor: ok' || E'\n' else '24 vendor_chat_for_booking is null for the removed vendor: FAIL' || E'\n' end;

  -- The Glasshouse can't see who was removed.
  perform set_config('request.jwt.claims', json_build_object('sub', v2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.event_vendor_removals where event_id = v_event;
  r := r || case when n = 0 then '25 vendors can''t read event_vendor_removals: ok' || E'\n' else '25 vendors can''t read event_vendor_removals: FAIL' || E'\n' end;
  begin
    insert into public.event_vendor_removals (event_id, provider_id) values (v_event, p2);
    r := r || '26 nobody writes event_vendor_removals directly: FAIL' || E'\n';
  exception when others then
    r := r || '26 nobody writes event_vendor_removals directly: ok' || E'\n';
  end;

  -- Rosa adds DJ Nova back.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_ok := public.readd_event_vendor(v_event, p1);
  select count(*) into n from public.conversation_members where conversation_id = v_chat and profile_id = v1;
  r := r || case when v_ok and n = 1 then '27 readd_event_vendor brings the vendor back: ok' || E'\n' else '27 readd_event_vendor brings the vendor back: FAIL' || E'\n' end;

  -- DJ Nova cancels: they leave, the chat stays with one vendor.
  reset role;
  update public.bookings set status = 'cancelled_by_provider' where id = bk1;
  select count(*) into n from public.conversation_members where conversation_id = v_chat and profile_id = v1;
  select count(*) into m from public.messages where conversation_id = v_chat and body = 'DJ Nova Test left the vendor chat';
  r := r || case when n = 0 and m = 1 then '28 cancelled vendor leaves with a "left" note: ok' || E'\n' else format('28 cancelled vendor leaves with a "left" note (%s, %s): FAIL', n, m) || E'\n' end;
  select count(*) into n from public.conversations where id = v_chat;
  r := r || case when n = 1 then '29 down to one vendor, the chat stays: ok' || E'\n' else '29 down to one vendor, the chat stays: FAIL' || E'\n' end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ok := public.readd_event_vendor(v_event, p1);
  select count(*) into n from public.conversation_members where conversation_id = v_chat and profile_id = v1;
  r := r || case when not v_ok and n = 0 then '30 readd_event_vendor is false without an eligible booking: ok' || E'\n' else '30 readd_event_vendor is false without an eligible booking: FAIL' || E'\n' end;
  begin
    perform public.remove_event_vendor(v_event, p1);
    r := r || '31 can''t remove a vendor without an eligible booking: FAIL' || E'\n';
  exception when others then
    r := r || '31 can''t remove a vendor without an eligible booking: ok' || E'\n';
  end;

  -- A new DJ is accepted: joins and reads the history.
  reset role;
  insert into public.bookings (client_id, provider_id, event_id, status, time_range, timezone, total_cents, package_snapshot)
  values (a, p3, v_event, 'accepted', tstzrange(now() + interval '30 days', now() + interval '30 days 4 hours'), 'America/Los_Angeles', 80000, '{"name": "Night set"}')
  returning id into bk3;
  select count(*) into n from public.conversation_members where conversation_id = v_chat and profile_id = v3;
  select count(*) into m from public.messages where conversation_id = v_chat and body = 'Beat Box Test joined the vendor chat';
  r := r || case when n = 1 and m = 1 then '32 new vendor joins with a "joined" note: ok' || E'\n' else format('32 new vendor joins with a "joined" note (%s, %s): FAIL', n, m) || E'\n' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v3, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.messages where conversation_id = v_chat and body = 'What time is curfew?';
  r := r || case when n = 1 then '33 new vendor reads earlier messages: ok' || E'\n' else '33 new vendor reads earlier messages: FAIL' || E'\n' end;
  v_id := public.vendor_chat_for_booking(bk3);
  r := r || case when v_id = v_chat then '34 vendor_chat_for_booking for the vendor: ok' || E'\n' else '34 vendor_chat_for_booking for the vendor: FAIL' || E'\n' end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_id := public.vendor_chat_for_booking(bk3);
  r := r || case when v_id = v_chat then '35 vendor_chat_for_booking for the client: ok' || E'\n' else '35 vendor_chat_for_booking for the client: FAIL' || E'\n' end;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  v_id := public.vendor_chat_for_booking(bk3);
  r := r || case when v_id is null then '36 vendor_chat_for_booking is null for a stranger: ok' || E'\n' else '36 vendor_chat_for_booking is null for a stranger: FAIL' || E'\n' end;
  begin
    perform public.event_vendor_chat(v_event);
    r := r || '37 strangers can''t call event_vendor_chat: FAIL' || E'\n';
  exception when others then
    r := r || '37 strangers can''t call event_vendor_chat: ok' || E'\n';
  end;

  -- Planners come and go with the event.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.invite_to_event(v_event, array[c]);
  select count(*) into n from public.conversation_members where conversation_id = v_chat and profile_id = c;
  r := r || case when n = 1 then '38 a new co-planner joins the vendor chat: ok' || E'\n' else '38 a new co-planner joins the vendor chat: FAIL' || E'\n' end;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.leave_event(v_event);
  reset role;
  select count(*) into n from public.conversation_members where conversation_id = v_chat and profile_id = c;
  r := r || case when n = 0 then '39 a co-planner who leaves is out of the vendor chat: ok' || E'\n' else '39 a co-planner who leaves is out of the vendor chat: FAIL' || E'\n' end;

  -- Two syncs in a row change nothing.
  select count(*) into m from public.conversation_members where conversation_id = v_chat;
  perform public.sync_event_vendor_chat(v_event);
  perform public.sync_event_vendor_chat(v_event);
  select count(*) into n from public.conversations where event_id = v_event and kind = 'event_vendors';
  r := r || case when n = 1 and m = (select count(*) from public.conversation_members where conversation_id = v_chat)
    then '40 repeated syncs add no chat or members: ok' || E'\n' else format('40 repeated syncs add no chat or members (%s): FAIL', n) || E'\n' end;

  -- Renaming the event renames the vendor chat; the planning chat stays its own.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.events set title = 'Rosa & Dev' where id = v_event;
  select count(*) into n from public.conversations where id = v_chat and title = 'Vendors · Rosa & Dev';
  select n + count(*) into n from public.conversations where id = v_plan_chat and kind = 'event' and title = 'Rosa & Dev';
  r := r || case when n = 2 then '41 vendor chat title follows the event: ok' || E'\n' else format('41 vendor chat title follows the event (%s): FAIL', n) || E'\n' end;

  -- 14 days after the event the chat is read-only; bookings still change, without notes.
  update public.events set starts_at = now() - interval '20 days', ends_at = now() - interval '20 days' where id = v_event;
  v_res := public.event_vendor_chat(v_event);
  r := r || case when (v_res ->> 'closed')::boolean and (v_res ->> 'closes_at')::timestamptz < now()
    then '42 event_vendor_chat reports closed: ok' || E'\n' else '42 event_vendor_chat reports closed: FAIL' || E'\n' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v2, 'role', 'authenticated')::text, true);
  begin
    insert into public.messages (conversation_id, body) values (v_chat, 'One more thing');
    r := r || '43 closed chat refuses messages: FAIL' || E'\n';
  exception when others then
    r := r || case when sqlerrm like '%This vendor chat is closed%' then '43 closed chat refuses messages: ok' || E'\n' else format('43 closed chat refuses messages (%s): FAIL', sqlerrm) || E'\n' end;
  end;
  reset role;
  select count(*) into m from public.messages where conversation_id = v_chat;
  update public.bookings set status = 'cancelled_by_client' where id = bk2;
  select status::text into t from public.bookings where id = bk2;
  select count(*) into n from public.messages where conversation_id = v_chat;
  r := r || case when t = 'cancelled_by_client' and n = m then '44 booking change after closing works, no new note: ok' || E'\n' else format('44 booking change after closing works, no new note (%s, %s, %s): FAIL', t, n, m) || E'\n' end;

  -- A cancelled event closes the chat right away, whatever its dates.
  update public.events set starts_at = now() + interval '30 days', ends_at = now() + interval '30 days', status = 'cancelled' where id = v_event;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.messages (conversation_id, body) values (v_chat, 'Are we still on?');
    r := r || '45 cancelled event closes the chat: FAIL' || E'\n';
  exception when others then
    r := r || case when sqlerrm like '%This vendor chat is closed%' then '45 cancelled event closes the chat: ok' || E'\n' else format('45 cancelled event closes the chat (%s): FAIL', sqlerrm) || E'\n' end;
  end;
  v_res := public.vendor_chat_info(v_chat);
  r := r || case when (v_res ->> 'closed')::boolean and (v_res ->> 'is_planner')::boolean then '46 vendor_chat_info reports closed: ok' || E'\n' else '46 vendor_chat_info reports closed: FAIL' || E'\n' end;

  -- Signed-out visitors can't call any of it.
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  begin
    perform public.event_vendor_chat(v_event);
    r := r || '47 signed-out visitors blocked: FAIL' || E'\n';
  exception when insufficient_privilege then
    r := r || '47 signed-out visitors blocked: ok' || E'\n';
  end;
  reset role;
  raise exception 'EVENT VENDOR CHAT TEST RESULTS (rolled back):%', r;
end $$;
