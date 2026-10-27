const { supabaseAdmin, isConfigured } = require('../config/supabase');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.SETU_DATA_DIR || path.join(__dirname, '../../uploads/data');
// Local storage is only used when Supabase is absent (isolated tests). A configured
// database failure must never report success or reveal an unavailable contact.
const read = (name, fallback) => { const file = path.join(directory, name); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; };
const write = (name, value) => { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, name), JSON.stringify(value)); };
class CallModel {
    static async getUserAvailability(userId) {
        if (isConfigured) {
            const { data, error } = await supabaseAdmin.from('profiles').select('is_call_available').eq('id', userId).maybeSingle();
            if (error) throw error;
            return data?.is_call_available === true;
        }
        const values = read('availability.json', {});
        return typeof values[userId] === 'boolean' ? values[userId] : true;
    }
    static async setUserAvailability(userId, value) {
        if (typeof value !== 'boolean') throw new Error('Availability must be a boolean.');
        if (isConfigured) {
            const { data, error } = await supabaseAdmin.from('profiles').update({ is_call_available: value, updated_at: new Date().toISOString() }).eq('id', userId).select('id,is_call_available').single();
            if (error) throw error;
            return data.is_call_available;
        }
        const values = read('availability.json', {}); values[userId] = value; write('availability.json', values); return value;
    }
    static async logCall({ caller_id, receiver_id, crop_id = null, caller_role, receiver_role, status, phone_revealed = null }) {
        const entry = { id: randomUUID(), caller_id, receiver_id, crop_id, caller_role, receiver_role, status, phone_revealed, created_at: new Date().toISOString() };
        if (isConfigured) {
            const { data, error } = await supabaseAdmin.from('call_logs').insert(entry).select().single();
            if (error) throw error;
            return data;
        }
        const values = read('calls.json', []); values.push(entry); write('calls.json', values); return entry;
    }
    static async listUserCalls(userId) {
        if (isConfigured) {
            let query = supabaseAdmin.from('call_logs').select('*').order('created_at', { ascending: false }).limit(500);
            if (userId) query = query.or(`caller_id.eq.${userId},receiver_id.eq.${userId}`);
            const { data, error } = await query;
            if (error) throw error;
            return data;
        }
        return read('calls.json', []).filter((entry) => !userId || entry.caller_id === userId || entry.receiver_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 500);
    }
}
module.exports = { CallModel };
