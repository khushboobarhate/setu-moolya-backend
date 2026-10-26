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
            .order("created_at", { ascending: false });

        if (status) query = query.eq("status", status);
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

    static async findActiveRegistrationByEmail(email) {
        const { data, error } = await supabaseAdmin.from("registration_requests")
            .select("*").eq("email", email).in("status", [REG_STATUS.PENDING, REG_STATUS.APPROVED]).maybeSingle();
        if (error) throw error;
        return data;
    }

    static async findByRegistrationRequestId(requestId) {
        const { data, error } = await supabaseAdmin.from("profiles")
            .select("*").eq("registration_request_id", requestId).maybeSingle();
        if (error) throw error;
        return data;
    }

    // Database leases serialize review and credential delivery across servers.
    static async claimRegistrationRequest(requestId, reviewToken) {
        const { data, error } = await supabaseAdmin.rpc("claim_registration_request", {
            p_request_id: requestId, p_review_token: reviewToken
        });
        if (error) throw error;
        return data?.[0] || null;
    }

    static async releaseRegistrationRequest(requestId, reviewToken) {
        const { error } = await supabaseAdmin.from("registration_requests")
            .update({ review_token: null, review_started_at: null }).eq("id", requestId).eq("review_token", reviewToken);
        if (error) throw error;
    }

    static async completeApproval(requestId, userId, reviewToken, adminId) {
        const { data, error } = await supabaseAdmin.rpc("complete_registration_approval", {
            p_request_id: requestId, p_user_id: userId, p_review_token: reviewToken, p_admin_id: adminId
        });
        if (error) throw error;
        return data;
    }

    static async updateReviewedRequest(requestId, reviewToken, updates) {
        const { data, error } = await supabaseAdmin.from("registration_requests")
            .update(updates).eq("id", requestId).eq("review_token", reviewToken).select().single();
        if (error) throw error;
        return data;
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
            .eq("is_approved", true)
            .range(offset, offset + limit - 1)
            .order("created_at", { ascending: false });
        if (error) throw error;
        return { users: data, total: count, page, totalPages: Math.ceil(count / limit) };
    }

    // ----------------------------------------------------------------
    // CALL AVAILABILITY
    // ----------------------------------------------------------------

    /**
     * Get user call availability (defaults to true / ON)
     */
    static async getCallAvailability(userId) {
        const { CallModel } = require("./callModel");
        return CallModel.getUserAvailability(userId);
    }

    /**
     * Set user call availability (true/false)
     */
    static async setCallAvailability(userId, isAvailable) {
        const { CallModel } = require("./callModel");
        return CallModel.setUserAvailability(userId, isAvailable);
    }
}

module.exports = { UserModel, ROLES, REG_STATUS };
