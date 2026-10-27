const { supabaseAdmin, supabase, isConfigured } = require("../config/supabase");
const { UserModel } = require("./userModel");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.SETU_DATA_DIR || path.join(__dirname, "../../uploads/data");
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const INTERESTS_FILE = path.join(DATA_DIR, "interests.json");

const readLocalInterests = () => {
    try {
        if (!fs.existsSync(INTERESTS_FILE)) return [];
        const raw = fs.readFileSync(INTERESTS_FILE, "utf8");
        return JSON.parse(raw || "[]");
    } catch {
        return [];
    }
};

const writeLocalInterests = (interests) => {
    try {
        fs.writeFileSync(INTERESTS_FILE, JSON.stringify(interests, null, 2), "utf8");
    } catch (err) {
        console.error("Failed to write to local interests file:", err.message);
    }
};


class InterestModel {
    /**
     * Upsert interest and rating for a crop by a buyer
     */
    static async upsertInterest({ crop_id, buyer_id, rating, notes = "" }) {
        const ratingNum = Number(rating);
        if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            throw new Error("Rating must be an integer between 1 and 5.");
        }

        const now = new Date().toISOString();
        const payload = {
            id: uuidv4(),
            crop_id,
            buyer_id,
            rating: ratingNum,
            notes: (notes || "").trim(),
            created_at: now,
            updated_at: now
        };

        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crop_interests")
                .upsert(
                    {
                        crop_id,
                        buyer_id,
                        rating: ratingNum,
                        notes: (notes || "").trim(),
                        updated_at: now
                    },
                    { onConflict: "crop_id,buyer_id" }
                )
                .select()
                .single();

            if (!error && data) {
                return data;
            }

            throw error || new Error("Database operation returned no result.");
        }

        // Fallback local store
        const interests = readLocalInterests();
        const existingIdx = interests.findIndex(
            (i) => i.crop_id === crop_id && i.buyer_id === buyer_id
        );

        if (existingIdx !== -1) {
            interests[existingIdx] = {
                ...interests[existingIdx],
                rating: ratingNum,
                notes: (notes || "").trim(),
                updated_at: now
            };
            writeLocalInterests(interests);
            return interests[existingIdx];
        } else {
            interests.push(payload);
            writeLocalInterests(interests);
            return payload;
        }
    }

    /**
     * Get all interests on a specific crop, including buyer details
     */
    static async findByCropId(crop_id) {
        let rawInterests = [];

        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crop_interests")
                .select("*")
                .eq("crop_id", crop_id)
                .order("created_at", { ascending: false });

            if (!error && data) {
                rawInterests = data;
            } else { throw error || new Error("Database operation returned no result."); }
        } else {
            rawInterests = readLocalInterests().filter((i) => i.crop_id === crop_id);
        }

        // Enrich with buyer profile information
        const enriched = await Promise.all(
            rawInterests.map(async (item) => {
                const buyer = await UserModel.findById(item.buyer_id);
                const { CallModel } = require("./callModel");
                const is_call_available = await CallModel.getUserAvailability(item.buyer_id);

                return {
                    ...item,
                    buyer: buyer
                        ? {
                              id: buyer.id,
                              full_name: buyer.full_name,
                              city: buyer.city,
                              state: buyer.state,
                              photo_url: buyer.photo_url,
                              is_call_available
                          }
                        : { id: item.buyer_id, is_call_available }
                };
            })
        );

        return enriched;
    }

    /**
     * Get all interests submitted by a specific buyer
     */
    static async findByBuyerId(buyer_id) {
        let rawInterests = [];

        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crop_interests")
                .select("*")
                .eq("buyer_id", buyer_id)
                .order("created_at", { ascending: false });

            if (!error && data) {
                rawInterests = data;
            } else { throw error || new Error("Database operation returned no result."); }
        } else {
            rawInterests = readLocalInterests().filter((i) => i.buyer_id === buyer_id);
        }

        const { CropModel } = require("./cropModel");
        const { CallModel } = require("./callModel");

        const enriched = await Promise.all(
            rawInterests.map(async (item) => {
                const crop = await CropModel.findById(item.crop_id);
                let farmer = null;
                if (crop) {
                    farmer = await UserModel.findById(crop.farmer_id);
                }
                const farmer_call_available = crop
                    ? await CallModel.getUserAvailability(crop.farmer_id)
                    : false;

                return {
                    ...item,
                    crop,
                    farmer: farmer
                        ? {
                              id: farmer.id,
                              full_name: farmer.full_name,
                              city: farmer.city,
                              state: farmer.state,
                              is_call_available: farmer_call_available
                          }
                        : null
                };
            })
        );

        return enriched;
    }

    /**
     * Check if a buyer has expressed interest in a specific crop
     */
    static async hasExpressedInterest(crop_id, buyer_id) {
        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crop_interests")
                .select("id")
                .eq("crop_id", crop_id)
                .eq("buyer_id", buyer_id)
                .single();

            if (!error && data) return true;
            if (error && error.code === "PGRST116") return false;
            throw error || new Error("Database operation returned no result.");
        }

        const interests = readLocalInterests();
        return interests.some((i) => i.crop_id === crop_id && i.buyer_id === buyer_id);
    }

    /**
     * Check if a buyer has expressed interest in ANY crop belonging to this farmer
     */
    static async hasInterestInFarmerCrops(farmer_id, buyer_id) {
        const { CropModel } = require("./cropModel");
        const farmerCrops = await CropModel.findByFarmerId(farmer_id);
        if (!farmerCrops || farmerCrops.length === 0) return false;

        const cropIds = farmerCrops.map((c) => c.id);

        if (isConfigured) {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from("crop_interests")
                .select("id")
                .in("crop_id", cropIds)
                .eq("buyer_id", buyer_id)
                .limit(1);

            if (!error && data && data.length > 0) return true;
            if (!error && data && data.length === 0) return false;
            throw error || new Error("Database operation returned no result.");
        }

        const interests = readLocalInterests();
        return interests.some(
            (i) => cropIds.includes(i.crop_id) && i.buyer_id === buyer_id
        );
    }

    /**
     * Get aggregate rating summary for a crop
     */
    static async getRatingSummary(crop_id) {
        const list = await this.findByCropId(crop_id);
        const total = list.length;
        if (total === 0) {
            return { average_rating: 0, total_ratings: 0 };
        }
        const sum = list.reduce((acc, curr) => acc + (curr.rating || 0), 0);
        return {
            average_rating: parseFloat((sum / total).toFixed(1)),
            total_ratings: total
        };
    }
}

module.exports = { InterestModel };
