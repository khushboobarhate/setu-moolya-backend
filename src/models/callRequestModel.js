const { supabaseAdmin, isConfigured } = require('../config/supabase');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const directory = process.env.SETU_DATA_DIR || path.join(__dirname, '../../uploads/data');

const read = (name, fallback) => {
    const file = path.join(directory, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
};

const write = (name, value) => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2));
};

class CallRequestModel {
    /**
     * Create a new call request from a buyer to a farmer
     */
    static async createRequest({ buyer_id, farmer_id, crop_id = null, buyer_note = null }) {
        const entry = {
            id: randomUUID(),
            buyer_id,
            farmer_id,
            crop_id: crop_id || null,
            status: 'pending',
            buyer_note: buyer_note ? String(buyer_note).trim() : null,
            rejection_reason: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            responded_at: null
        };

        if (isConfigured) {
            const { data, error } = await supabaseAdmin
                .from('call_requests')
                .insert(entry)
                .select()
                .single();
            if (error) throw error;
            return data;
        }

        const requests = read('call_requests.json', []);
        requests.push(entry);
        write('call_requests.json', requests);
        return entry;
    }

    /**
     * Find a request by its UUID
     */
    static async findById(id) {
        if (isConfigured) {
            const { data, error } = await supabaseAdmin
                .from('call_requests')
                .select('*')
                .eq('id', id)
                .maybeSingle();
            if (error) throw error;
            return data;
        }

        const requests = read('call_requests.json', []);
        return requests.find((r) => r.id === id) || null;
    }

    /**
     * Check if an active/pending request already exists between this buyer and farmer
     */
    static async findActiveBetween(buyer_id, farmer_id, crop_id = null) {
        if (isConfigured) {
            let query = supabaseAdmin
                .from('call_requests')
                .select('*')
                .eq('buyer_id', buyer_id)
                .eq('farmer_id', farmer_id)
                .eq('status', 'pending');
            if (crop_id) {
                query = query.eq('crop_id', crop_id);
            }
            const { data, error } = await query.maybeSingle();
            if (error) throw error;
            return data;
        }

        const requests = read('call_requests.json', []);
        return requests.find(
            (r) =>
                r.buyer_id === buyer_id &&
                r.farmer_id === farmer_id &&
                r.status === 'pending' &&
                (!crop_id || r.crop_id === crop_id)
        ) || null;
    }

    /**
     * List all call requests for a farmer (with buyer & crop metadata)
     */
    static async listForFarmer(farmer_id, { status } = {}) {
        if (isConfigured) {
            let query = supabaseAdmin
                .from('call_requests')
                .select(`
                    id, buyer_id, farmer_id, crop_id, status, buyer_note, rejection_reason, created_at, updated_at, responded_at,
                    buyer:profiles!call_requests_buyer_id_fkey(id, full_name, email, city, state, photo_url),
                    crop:crops!call_requests_crop_id_fkey(id, crop_name, crop_type, quantity, quantity_unit, price, photos)
                `)
                .eq('farmer_id', farmer_id)
                .order('created_at', { ascending: false });

            if (status) {
                query = query.eq('status', status);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        }

        const requests = read('call_requests.json', []);
        const users = read('users.json', []);
        const crops = read('crops.json', []);

        return requests
            .filter((r) => r.farmer_id === farmer_id && (!status || r.status === status))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .map((r) => {
                const buyer = users.find((u) => u.id === r.buyer_id);
                const crop = crops.find((c) => c.id === r.crop_id);
                return {
                    ...r,
                    buyer: buyer
                        ? {
                              id: buyer.id,
                              full_name: buyer.full_name,
                              email: buyer.email,
                              city: buyer.city,
                              state: buyer.state,
                              photo_url: buyer.photo_url
                          }
                        : null,
                    crop: crop
                        ? {
                              id: crop.id,
                              crop_name: crop.crop_name,
                              crop_type: crop.crop_type,
                              quantity: crop.quantity,
                              quantity_unit: crop.quantity_unit,
                              price: crop.price,
                              photos: crop.photos || []
                          }
                        : null
                };
            });
    }

    /**
     * List call requests initiated by a buyer
     */
    static async listForBuyer(buyer_id, { status } = {}) {
        if (isConfigured) {
            let query = supabaseAdmin
                .from('call_requests')
                .select(`
                    id, buyer_id, farmer_id, crop_id, status, buyer_note, rejection_reason, created_at, updated_at, responded_at,
                    farmer:profiles!call_requests_farmer_id_fkey(id, full_name, city, state, photo_url, mobile_number),
                    crop:crops!call_requests_crop_id_fkey(id, crop_name, crop_type, quantity, quantity_unit, price, photos)
                `)
                .eq('buyer_id', buyer_id)
                .order('created_at', { ascending: false });

            if (status) {
                query = query.eq('status', status);
            }

            const { data, error } = await query;
            if (error) throw error;
            // Only expose farmer mobile number if status is 'approved'
            return (data || []).map((req) => {
                const farmer = req.farmer ? { ...req.farmer } : null;
                if (farmer && req.status !== 'approved') {
                    delete farmer.mobile_number;
                }
                return { ...req, farmer };
            });
        }

        const requests = read('call_requests.json', []);
        const users = read('users.json', []);
        const crops = read('crops.json', []);

        return requests
            .filter((r) => r.buyer_id === buyer_id && (!status || r.status === status))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .map((r) => {
                const farmer = users.find((u) => u.id === r.farmer_id);
                const crop = crops.find((c) => c.id === r.crop_id);
                const farmerData = farmer
                    ? {
                          id: farmer.id,
                          full_name: farmer.full_name,
                          city: farmer.city,
                          state: farmer.state,
                          photo_url: farmer.photo_url,
                          ...(r.status === 'approved' ? { mobile_number: farmer.mobile_number } : {})
                      }
                    : null;

                return {
                    ...r,
                    farmer: farmerData,
                    crop: crop
                        ? {
                              id: crop.id,
                              crop_name: crop.crop_name,
                              crop_type: crop.crop_type,
                              quantity: crop.quantity,
                              quantity_unit: crop.quantity_unit,
                              price: crop.price,
                              photos: crop.photos || []
                          }
                        : null
                };
            });
    }

    /**
     * Farmer responds to call request (approve or reject)
     */
    static async updateStatus(id, farmer_id, status, { rejection_reason = null } = {}) {
        const now = new Date().toISOString();
        if (isConfigured) {
            const { data, error } = await supabaseAdmin
                .from('call_requests')
                .update({
                    status,
                    rejection_reason: status === 'rejected' ? rejection_reason : null,
                    responded_at: now,
                    updated_at: now
                })
                .eq('id', id)
                .eq('farmer_id', farmer_id)
                .select()
                .single();
            if (error) throw error;
            return data;
        }

        const requests = read('call_requests.json', []);
        const target = requests.find((r) => r.id === id && r.farmer_id === farmer_id);
        if (!target) return null;

        target.status = status;
        target.rejection_reason = status === 'rejected' ? rejection_reason : null;
        target.responded_at = now;
        target.updated_at = now;
        write('call_requests.json', requests);
        return target;
    }

    /**
     * Count pending requests for a farmer badge
     */
    static async getPendingCount(farmer_id) {
        if (isConfigured) {
            const { count, error } = await supabaseAdmin
                .from('call_requests')
                .select('*', { count: 'exact', head: true })
                .eq('farmer_id', farmer_id)
                .eq('status', 'pending');
            if (error) throw error;
            return count || 0;
        }

        const requests = read('call_requests.json', []);
        return requests.filter((r) => r.farmer_id === farmer_id && r.status === 'pending').length;
    }
}

module.exports = { CallRequestModel };
