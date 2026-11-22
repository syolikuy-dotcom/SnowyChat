// Daftar event Socket.IO yang dipakai klien. Dites terhadap server di tests/contract.test.mjs
// supaya klien & server tidak pernah diam-diam tidak sinkron.
export const SERVER_EVENTS = [
  'persistent_sessions', 'db_health', 'session_created', 'session_updated', 'status', 'chat', 'event',
  'stats', 'info', 'entities_list', 'inventory', 'map_data', 'container_items', 'window',
  'auto_hit_status', 'auto_bow_status', 'right_click_mode_status', 'cmd_schedule_status',
  'auto_sell_status', 'anti_afk_status', 'webhook_status', 'webhook_test_result', 'gens_event',
  'auto_commands_updated', 'render_distance_status', 'ping_result',
] as const;

export const CLIENT_EVENTS = [
  'mc:connect', 'mc:reconnect', 'mc:subscribe', 'mc:unsubscribe', 'mc:subscribe_chat', 'mc:chat', 'mc:info',
  'mc:move', 'mc:stop_movement', 'mc:get_entities', 'mc:attack',
  'mc:auto_hit_start', 'mc:auto_hit_stop', 'mc:auto_hit_delay', 'mc:auto_respawn',
  'mc:auto_bow_start', 'mc:auto_bow_stop', 'mc:auto_bow_range', 'mc:right_click_mode',
  'mc:cmd_schedule_start', 'mc:cmd_schedule_stop', 'mc:set_cmd_schedules',
  'mc:auto_sell_enable', 'mc:auto_sell_set_config', 'mc:anti_afk_start', 'mc:anti_afk_stop',
  'mc:event_watch_toggle', 'mc:set_webhook', 'mc:test_webhook', 'mc:set_render_distance',
  'mc:set_auto_commands', 'mc:run_auto_commands_now', 'mc:set_auto_reconnect',
  'mc:get_inventory', 'mc:equip', 'mc:unequip', 'mc:drop_item', 'mc:select_slot',
  'mc:open_chest', 'mc:close_container', 'mc:get_container_items', 'mc:withdraw', 'mc:deposit',
  'mc:update_session', 'mc:disconnect', 'mc:ping', 'mc:connect_all', 'mc:disconnect_all', 'mc:list_bots',
  'mc:check_username',
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];
