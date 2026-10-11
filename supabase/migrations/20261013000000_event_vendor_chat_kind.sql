-- Event vendor chat, part 1: the new conversation kind. It sits in its own file because a
-- new enum value can't be used in the transaction that adds it (part 2 uses it).
alter type public.conversation_kind add value if not exists 'event_vendors';
