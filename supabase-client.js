const config = window.SUPABASE_CONFIG;
const createClient = window.supabase?.createClient;

window.courtsideSupabase = config && createClient
  ? createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true
    }
  })
  : null;