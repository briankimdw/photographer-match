import os

# Tests never talk to the real Supabase project: these take precedence over backend/.env.
os.environ["SUPABASE_URL"] = "http://supabase.invalid"
os.environ["SUPABASE_KEY"] = "test-anon-key"
os.environ["SUPABASE_JWT_SECRET"] = "test-jwt-secret"
