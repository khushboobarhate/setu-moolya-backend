const { supabase, supabaseAdmin, isConfigured } = require("../config/supabase");

const ROLES = {
    FARMER: "farmer",         // Foragers and rural herb cultivators
    FPO: "fpo",               // Farmer Producer Organisations / Village Collectives
    BUYER: "buyer",           // Domestic and International B2B Herb / Extract Buyers
    LAB: "lab",               // Quality Certification & Chemical Testing Labs (AYUSH/NABL)
    LOGISTICS: "logistics",   // Cold-chain, transportation & export partners
    ADMIN: "admin"            // Platform administrators & NGO agronomists
};

const KYC_STATUS = {
    PENDING: "pending",
    VERIFIED: "verified",
    REJECTED: "rejected"
};

class UserModel {
    static getRoles() {
        return Object.values(ROLES);
    }

    static isValidRole(role) {
        return Object.values(ROLES).includes(role);
    }

    /**
     * Find a user profile by Supabase Auth UUID
     */
    static async findById(id) {
        if (!isConfigured) throw new Error("Supabase is not configured yet. Add your credentials in .env");

        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("profiles")
            .select("*")
            .eq("id", id)
            .single();

        if (error && error.code !== "PGRST116") { // PGRST116 is code for no rows returned
            throw error;
        }

        return data;
    }

    /**
     * Find a user profile by email
     */
    static async findByEmail(email) {
        if (!isConfigured) throw new Error("Supabase is not configured yet. Add your credentials in .env");

        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("profiles")
            .select("*")
            .eq("email", email)
            .single();

        if (error && error.code !== "PGRST116") {
            throw error;
        }

        return data;
    }

    /**
     * Insert or upsert user profile
     */
    static async upsertProfile(profileData) {
        if (!isConfigured) throw new Error("Supabase is not configured yet. Add your credentials in .env");

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
     * Update user profile by ID
     */
    static async updateProfile(id, updates) {
        if (!isConfigured) throw new Error("Supabase is not configured yet. Add your credentials in .env");

        // Protect critical fields from arbitrary user updates
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

    /**
     * Fetch users by specific role (e.g. all FPOs or verified Labs)
     */
    static async findByRole(role, { page = 1, limit = 20, isVerified = null } = {}) {
        if (!isConfigured) throw new Error("Supabase is not configured yet. Add your credentials in .env");

        const client = supabaseAdmin || supabase;
        const offset = (page - 1) * limit;

        let query = client
            .from("profiles")
            .select("*", { count: "exact" })
            .eq("role", role);

        if (isVerified !== null) {
            query = query.eq("is_verified", isVerified);
        }

        const { data, error, count } = await query
            .range(offset, offset + limit - 1)
            .order("created_at", { ascending: false });

        if (error) throw error;

        return {
            users: data,
            total: count,
            page,
            totalPages: Math.ceil(count / limit)
        };
    }

    /**
     * Update KYC and verification status (admin only)
     */
    static async updateKyc(id, status, isVerified = false) {
        if (!isConfigured) throw new Error("Supabase is not configured yet. Add your credentials in .env");

        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from("profiles")
            .update({
                kyc_status: status,
                is_verified: isVerified,
                updated_at: new Date().toISOString()
            })
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;
        return data;
    }
}

module.exports = {
    UserModel,
    ROLES,
    KYC_STATUS
};
