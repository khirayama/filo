-- Reading playback is a client-local snapshot of the reading list.
-- Remove the unused server-side queue and cross-device playback state.
DROP TABLE IF EXISTS playback_states;
DROP TABLE IF EXISTS playback_queue_items;
