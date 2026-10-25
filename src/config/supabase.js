const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let supabaseAdmin = null;

const isConfigured = Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes("your-project-ref") &&
    !supabaseAnonKey.includes("your_supabase_anon_key")
);

if (isConfigured) {
    try {
        // Standard client for user-scoped operations
        supabase = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                autoRefreshToken: true,
                persistSession: false
            }
        });

        // Admin client with service role key for privileged operations (bypassing RLS)
        if (supabaseServiceKey && !supabaseServiceKey.includes("your_supabase_service_role_key")) {
            supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            });
        } else {
            supabaseAdmin = supabase; // Fallback to standard client
        }

        console.log("✅ Supabase client successfully initialized.");
    } catch (error) {
        console.error("❌ Failed to initialize Supabase client:", error.message);
    }
} else {
    console.warn("⚠️  [NOTICE] Supabase credentials not yet detected in .env file.");
    console.warn("👉  Please configure SUPABASE_URL and SUPABASE_ANON_KEY in your .env file.");
}

module.exports = {
    supabase,
    supabaseAdmin,
    isConfigured
};
