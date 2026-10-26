const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ quiet: true });

const configuredValue = (value) => typeof value === "string" && value.trim() && !/your[_-]|change_this/i.test(value);
const authOptions = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };
let supabase = null;
let supabaseAdmin = null;

// Never substitute the public client for the service-role client.
if ([process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY].every(configuredValue)) {
    try {
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: authOptions });
        supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: authOptions });
    } catch (error) {
        console.error("Supabase initialization failed:", error.message);
        supabase = null;
        supabaseAdmin = null;
    }
}

const isConfigured = Boolean(supabase && supabaseAdmin);

// Isolate login/recovery sessions between concurrent HTTP requests.
const createAuthClient = () => {
    if (!isConfigured) throw new Error("Supabase is not configured.");
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: authOptions });
};

module.exports = { supabase, supabaseAdmin, isConfigured, createAuthClient };
