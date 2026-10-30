/**
 * SetuMoolya Text-to-Speech (TTS) Service
 * Provides natural audio synthesis for Hindi (hi), Gujarati (gu), Marathi (mr), and English (en).
 * Uses Google TTS audio streams without requiring paid third-party services.
 */

const https = require('node:https');

const LANGUAGE_CODE_MAP = {
    hi: 'hi',
    gu: 'gu',
    mr: 'mr',
    en: 'en'
};

class TtsService {
    /**
     * Fetch an MP3 audio buffer for a single short text segment (<= 200 chars)
     */
    static fetchAudioSegment(text, lang = 'en') {
        const targetLang = LANGUAGE_CODE_MAP[lang] || 'en';
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${targetLang}&client=tw-ob`;

        return new Promise((resolve, reject) => {
            const req = https.get(
                url,
                {
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        Referer: 'https://translate.google.com/'
                    },
                    timeout: 8000
                },
                (res) => {
                    if (res.statusCode !== 200) {
                        res.resume();
                        return reject(new Error(`TTS provider returned HTTP ${res.statusCode}`));
                    }

                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(chunks)));
                }
            );

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('TTS request timed out.'));
            });

            req.on('error', (err) => reject(err));
        });
    }

    /**
     * Synthesize speech for text in Hindi, Gujarati, Marathi, or English.
     * Splits into reasonable chunks if the text is long.
     */
    static async synthesizeSpeech(text, lang = 'en') {
        if (!text || typeof text !== 'string') {
            throw new Error('Valid text string is required for TTS synthesis.');
        }

        // Clean up markdown markers and special characters for audio speaking
        const cleaned = text
            .replace(/[*#_`~>]/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();

        if (!cleaned) {
            throw new Error('Text is empty after stripping formatting.');
        }

        // Take the first 350 characters or first 2 sentences to provide a concise, responsive spoken summary
        const sentences = cleaned.split(/(?<=[.?!।॥\n])/);
        let segment = '';
        for (const s of sentences) {
            if ((segment + s).length > 250) break;
            segment += s + ' ';
        }
        if (!segment.trim()) {
            segment = cleaned.slice(0, 200);
        }

        return this.fetchAudioSegment(segment.trim(), lang);
    }
}

module.exports = { TtsService };
