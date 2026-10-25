const { supabaseAdmin, supabase, isConfigured } = require("../config/supabase");

/**
 * Roles supported by this platform (Admin, Farmer, Buyer only)
 */
const ROLES = {
    ADMIN: "admin",
    FARMER: "farmer",
    BUYER: "buyer"
};

/**
 * Registration / Approval status
 */
const REG_STATUS = {
    PENDING: "pending",
    APPROVED: "approved",
    REJECTED: "rejected"
};

class UserModel {
    static getRoles() {
        return Object.values(ROLES);
    }

    static isValidRole(role) {
        return Object.values(ROLES).includes(role);
    }

    // ----------------------------------------------------------------
    // PROFILE CRUD
    // ----------------------------------------------------------------

    /**
     * Find a user profile by UUID
     */
    static async findById(id) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("profiles")
            .select("*")
            .eq("id", id)
            .single();
        if (error && error.code !== "PGRST116") throw error;
        return data;
    }

    /**
     * Find a user profile by email
     */
    static async findByEmail(email) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("profiles")
            .select("*")
            .eq("email", email)
            .single();
        if (error && error.code !== "PGRST116") throw error;
        return data;
    }

    /**
     * Insert or upsert a user profile record
     */
    static async upsertProfile(profileData) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("profiles")
            .upsert(profileData, { onConflict: "id" })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Update arbitrary fields on a profile by ID
     */
    static async updateProfile(id, updates) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        delete updates.id;
        delete updates.created_at;
        updates.updated_at = new Date().toISOString();
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("profiles")
            .update(updates)
            .eq("id", id)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    // ----------------------------------------------------------------
    // REGISTRATION REQUESTS
    // ----------------------------------------------------------------

    /**
     * Create a new pending registration request (stored in registration_requests table)
     */
    static async createRegistrationRequest(payload) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("registration_requests")
            .insert(payload)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Fetch all pending registration requests with optional role filter
     * @param {object} options - { role, status, page, limit }
     */
    static async listRegistrationRequests({ role = null, status = REG_STATUS.PENDING, page = 1, limit = 50 } = {}) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const offset = (page - 1) * limit;

        let query = client
            .from("registration_requests")
            .select("*", { count: "exact" })
            .eq("status", status)
            .order("created_at", { ascending: false });

        if (role) query = query.eq("role", role);

        const { data, error, count } = await query.range(offset, offset + limit - 1);
        if (error) throw error;

        return {
            requests: data,
            total: count,
            page,
            totalPages: Math.ceil(count / limit)
        };
    }

    /**
     * Fetch a single registration request by ID
     */
    static async findRegistrationRequestById(requestId) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("registration_requests")
            .select("*")
            .eq("id", requestId)
            .single();
        if (error && error.code !== "PGRST116") throw error;
        return data;
    }

    /**
     * Update the status of a registration request
     */
    static async updateRegistrationStatus(requestId, status, extraFields = {}) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("registration_requests")
            .update({
                status,
                updated_at: new Date().toISOString(),
                ...extraFields
            })
            .eq("id", requestId)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    // ----------------------------------------------------------------
    // OTP MANAGEMENT
    // ----------------------------------------------------------------

    /**
     * Store an OTP record for mobile verification
     */
    static async storeOtp({ phone, otp, expiresAt }) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        // Upsert by phone – one pending OTP per phone at a time
        const { data, error } = await client
            .from("otp_records")
            .upsert(
                { phone, otp, expires_at: expiresAt, is_used: false },
                { onConflict: "phone" }
            )
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Verify an OTP for a given phone number
     * Returns { valid: boolean, message: string }
     */
    static async verifyOtp(phone, otp) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("otp_records")
            .select("*")
            .eq("phone", phone)
            .eq("otp", otp)
            .eq("is_used", false)
            .single();

        if (error || !data) return { valid: false, message: "Invalid OTP." };
        if (new Date(data.expires_at) < new Date()) return { valid: false, message: "OTP has expired." };

        // Mark OTP as used
        await client
            .from("otp_records")
            .update({ is_used: true })
            .eq("phone", phone);

        return { valid: true, message: "OTP verified successfully." };
    }

    // ----------------------------------------------------------------
    // ADMIN QUERIES
    // ----------------------------------------------------------------

    /**
     * Fetch profiles by role (approved users)
     */
    static async findByRole(role, { page = 1, limit = 20 } = {}) {
        if (!isConfigured) throw new Error("Supabase is not configured.");
        const client = supabaseAdmin || supabase;
        const offset = (page - 1) * limit;
        const { data, error, count } = await client
            .from("profiles")
            .select("*", { count: "exact" })
            .eq("role", role)
            .range(offset, offset + limit - 1)
            .order("created_at", { ascending: false });
        if (error) throw error;
        return { users: data, total: count, page, totalPages: Math.ceil(count / limit) };
    }
}

module.exports = { UserModel, ROLES, REG_STATUS };
