const { supabaseAdmin, supabase, isConfigured } = require("../config/supabase");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.SETU_DATA_DIR || path.join(__dirname, "../../uploads/data");
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const AVAIL_FILE = path.join(DATA_DIR, "availability.json");
const CALLS_FILE = path.join(DATA_DIR, "calls.json");

const readJson = (file) => {
    try {
        if (!fs.existsSync(file)) return {};
        const raw = fs.readFileSync(file, "utf8");
        return JSON.parse(raw || "{}");
    } catch {
        return {};
    }
};

const writeJson = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
        console.error(`Failed to write to ${file}:`, err.message);
    }
};

const isSchemaError = (err) => {
    if (!err) return false;
    const msg = (err.message || "").toLowerCase();
    return (
        msg.includes("could not find") ||
        msg.includes("does not exist") ||
        msg.includes("relation") ||
        msg.includes("schema cache") ||
        err.code === "PGRST204" ||
        err.code === "42P01" ||
        err.code === "42703"
    );
};

class CallModel {
    /**
     * Get user call availability (defaults to true / ON)
     */
    static async getUserAvailability(userId) {
        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("profiles")
                .select("is_call_available")
                .eq("id", userId)
                .single();

            if (!error && data && typeof data.is_call_available === "boolean") {
                return data.is_call_available;
            }

            if (error && !isSchemaError(error) && error.code !== "PGRST116") {
                console.warn("Supabase availability check warning:", error.message);
            }
        }

        // Check local store
        const availMap = readJson(AVAIL_FILE);
        if (typeof availMap[userId] === "boolean") {
            return availMap[userId];
        }

        // Default to ON (true)
        return true;
    }

    /**
     * Set user call availability (ON = true, OFF = false)
     */
    static async setUserAvailability(userId, isAvailable) {
        const boolVal = Boolean(isAvailable);

        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { error } = await client
                .from("profiles")
                .update({ is_call_available: boolVal, updated_at: new Date().toISOString() })
                .eq("id", userId);

            if (error && !isSchemaError(error)) {
                console.warn("Supabase availability update warning:", error.message);
            }
        }

        // Always save to local store as well for instant consistency
        const availMap = readJson(AVAIL_FILE);
        availMap[userId] = boolVal;
        writeJson(AVAIL_FILE, availMap);

        return boolVal;
    }

    /**
     * Log a call attempt or connection
     */
    static async logCall({
        caller_id,
        receiver_id,
        crop_id = null,
        caller_role,
        receiver_role,
        status,
        phone_revealed = null
    }) {
        const logEntry = {
            id: uuidv4(),
            caller_id,
            receiver_id,
            crop_id,
            caller_role,
            receiver_role,
            status,
            phone_revealed,
            created_at: new Date().toISOString()
        };

        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("call_logs")
                .insert(logEntry)
                .select()
                .single();

            if (!error && data) {
                return data;
            }
        }

        // Fallback local store
        const list = Array.isArray(readJson(CALLS_FILE)) ? readJson(CALLS_FILE) : [];
        list.push(logEntry);
        writeJson(CALLS_FILE, list);
        return logEntry;
    }

    /**
     * List call logs for a user
     */
    static async listUserCalls(userId) {
        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            let query = client
                .from("call_logs")
                .select("*")
                .order("created_at", { ascending: false });

            if (userId) {
                query = query.or(`caller_id.eq.${userId},receiver_id.eq.${userId}`);
            }

            const { data, error } = await query;
            if (!error && data) {
                return data;
            }
        }

        const list = Array.isArray(readJson(CALLS_FILE)) ? readJson(CALLS_FILE) : [];
        if (!userId) {
            return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        return list
            .filter((c) => c.caller_id === userId || c.receiver_id === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
}

module.exports = { CallModel };
