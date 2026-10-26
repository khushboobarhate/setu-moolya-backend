const { supabaseAdmin, supabase, isConfigured } = require("../config/supabase");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.SETU_DATA_DIR || path.join(__dirname, "../../uploads/data");
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const CROPS_FILE = path.join(DATA_DIR, "crops.json");

// Helper for local file fallback
const readLocalCrops = () => {
    try {
        if (!fs.existsSync(CROPS_FILE)) return [];
        const raw = fs.readFileSync(CROPS_FILE, "utf8");
        return JSON.parse(raw || "[]");
    } catch {
        return [];
    }
};

const writeLocalCrops = (crops) => {
    try {
        fs.writeFileSync(CROPS_FILE, JSON.stringify(crops, null, 2), "utf8");
    } catch (err) {
        console.error("Failed to write to local crops file:", err.message);
    }
};

const isSchemaError = (err) => {
    if (!err) return false;
    const msg = (err.message || "").toLowerCase();
    return (
        msg.includes("could not find the table") ||
        msg.includes("relation") ||
        msg.includes("schema cache") ||
        err.code === "PGRST204" ||
        err.code === "42P01"
    );
};

class CropModel {
    /**
     * Create a new crop listing
     */
    static async createCrop({
        farmer_id,
        crop_name,
        crop_type,
        quantity,
        quantity_unit = "kg",
        price,
        description = "",
        photos = []
    }) {
        const normalizedType = crop_type.toLowerCase() === "non-organic" ? "inorganic" : crop_type.toLowerCase();
        const newCrop = {
            id: uuidv4(),
            farmer_id,
            crop_name: crop_name.trim(),
            crop_type: normalizedType,
            quantity: parseFloat(quantity),
            quantity_unit: (quantity_unit || "kg").trim(),
            price: parseFloat(price),
            description: (description || "").trim(),
            photos: Array.isArray(photos) ? photos : (photos ? [photos] : []),
            status: "available",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crops")
                .insert(newCrop)
                .select()
                .single();

            if (!error && data) {
                return data;
            }

            if (!isSchemaError(error)) {
                throw error;
            }
        }

        // Fallback to local store
        const crops = readLocalCrops();
        crops.push(newCrop);
        writeLocalCrops(crops);
        return newCrop;
    }

    /**
     * Find all crops by a specific farmer
     */
    static async findByFarmerId(farmer_id) {
        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crops")
                .select("*")
                .eq("farmer_id", farmer_id)
                .order("created_at", { ascending: false });

            if (!error && data) {
                return data;
            }

            if (!isSchemaError(error)) {
                throw error;
            }
        }

        const crops = readLocalCrops();
        return crops
            .filter((c) => c.farmer_id === farmer_id)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    /**
     * Find a single crop by ID
     */
    static async findById(cropId) {
        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crops")
                .select("*")
                .eq("id", cropId)
                .single();

            if (!error && data) {
                return data;
            }

            if (error && error.code === "PGRST116") {
                return null;
            }

            if (!isSchemaError(error)) {
                throw error;
            }
        }

        const crops = readLocalCrops();
        return crops.find((c) => c.id === cropId) || null;
    }

    /**
     * Find all available crops for buyers, with optional filters
     */
    static async findAllAvailable({ crop_type = null, search = null } = {}) {
        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            let query = client
                .from("crops")
                .select("*")
                .eq("status", "available")
                .order("created_at", { ascending: false });

            if (crop_type) {
                const normType = crop_type.toLowerCase() === "non-organic" ? "inorganic" : crop_type.toLowerCase();
                query = query.eq("crop_type", normType);
            }

            if (search) {
                query = query.ilike("crop_name", `%${search}%`);
            }

            const { data, error } = await query;
            if (!error && data) {
                return data;
            }

            if (!isSchemaError(error)) {
                throw error;
            }
        }

        let crops = readLocalCrops().filter((c) => c.status === "available");
        if (crop_type) {
            const normType = crop_type.toLowerCase() === "non-organic" ? "inorganic" : crop_type.toLowerCase();
            crops = crops.filter((c) => c.crop_type === normType);
        }
        if (search) {
            const s = search.toLowerCase();
            crops = crops.filter((c) => c.crop_name.toLowerCase().includes(s) || (c.description && c.description.toLowerCase().includes(s)));
        }

        return crops.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    /**
     * Update crop details
     */
    static async updateCrop(cropId, farmerId, updates) {
        const cleanUpdates = { ...updates };
        delete cleanUpdates.id;
        delete cleanUpdates.farmer_id;
        delete cleanUpdates.created_at;
        cleanUpdates.updated_at = new Date().toISOString();

        if (cleanUpdates.crop_type) {
            cleanUpdates.crop_type = cleanUpdates.crop_type.toLowerCase() === "non-organic"
                ? "inorganic"
                : cleanUpdates.crop_type.toLowerCase();
        }

        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crops")
                .update(cleanUpdates)
                .eq("id", cropId)
                .eq("farmer_id", farmerId)
                .select()
                .single();

            if (!error && data) {
                return data;
            }

            if (!isSchemaError(error)) {
                throw error;
            }
        }

        const crops = readLocalCrops();
        const index = crops.findIndex((c) => c.id === cropId && c.farmer_id === farmerId);
        if (index === -1) return null;

        crops[index] = { ...crops[index], ...cleanUpdates };
        writeLocalCrops(crops);
        return crops[index];
    }

    /**
     * Delete or archive a crop
     */
    static async deleteCrop(cropId, farmerId) {
        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crops")
                .delete()
                .eq("id", cropId)
                .eq("farmer_id", farmerId)
                .select()
                .single();

            if (!error && data) {
                return true;
            }

            if (!isSchemaError(error)) {
                throw error;
            }
        }

        const crops = readLocalCrops();
        const filtered = crops.filter((c) => !(c.id === cropId && c.farmer_id === farmerId));
        if (filtered.length === crops.length) return false;
        writeLocalCrops(filtered);
        return true;
    }
}

module.exports = { CropModel };
