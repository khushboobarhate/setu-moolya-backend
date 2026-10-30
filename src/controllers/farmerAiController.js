const { GroqService } = require('../services/groqService');
const { MarketDataService } = require('../services/marketDataService');
const { TtsService } = require('../services/ttsService');
const { UserModel } = require('../models/userModel');
const { LANGUAGES } = require('../utils/validation');

/**
 * Controller: Farmer AI Assistant & Market Intelligence
 * Role-gated to authenticated, approved Farmers only.
 */

// ----------------------------------------------------------------
// 1. Conversational Agricultural Q&A
// ----------------------------------------------------------------
const askAi = async (req, res) => {
    try {
        const { message, language = 'en', conversationHistory = [] } = req.body || {};

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: 'A valid text question is required for the AI assistant.'
            });
        }

        const validLang = LANGUAGES.includes(language) ? language : 'en';

        const result = await GroqService.chat({
            message: message.trim(),
            language: validLang,
            conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : []
        });

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Farmer AI askAi Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to process AI assistant question. Please try again.'
        });
    }
};

// ----------------------------------------------------------------
// 2. Crop Image Analysis & Disease Diagnosis
// ----------------------------------------------------------------
const analyzeCrop = async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'Please upload a crop photograph for diagnosis.'
            });
        }

        const language = req.body?.language || 'en';
        const validLang = LANGUAGES.includes(language) ? language : 'en';

        const result = await GroqService.analyzeCropImage({
            imageBuffer: req.file.buffer,
            mimeType: req.file.mimetype || 'image/jpeg',
            language: validLang
        });

        return res.status(200).json({
            success: true,
            message: 'Crop image analyzed successfully.',
            data: result
        });
    } catch (error) {
        console.error('Farmer AI analyzeCrop Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to analyze crop photograph. Please verify the image file.'
        });
    }
};

// ----------------------------------------------------------------
// 3. Voice Transcription (Speech-to-Text)
// ----------------------------------------------------------------
const transcribeAudio = async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No voice recording audio file received.'
            });
        }

        const language = req.body?.language || 'en';
        const validLang = LANGUAGES.includes(language) ? language : 'en';

        const result = await GroqService.transcribeAudio({
            audioBuffer: req.file.buffer,
            filename: req.file.originalname || 'recording.webm',
            mimeType: req.file.mimetype || 'audio/webm',
            language: validLang
        });

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Farmer AI transcribeAudio Error:', error.message);
        return res.status(500).json({
            success: false,
            message: error.message || 'Voice transcription failed. Please try again or type your question.'
        });
    }
};

// ----------------------------------------------------------------
// 4. Text-to-Speech (TTS)
// ----------------------------------------------------------------
const getTtsAudio = async (req, res) => {
    try {
        const text = req.query.text || req.body?.text;
        const lang = req.query.lang || req.body?.lang || 'en';

        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Text query parameter is required for TTS synthesis.'
            });
        }

        const validLang = LANGUAGES.includes(lang) ? lang : 'en';
        const audioBuffer = await TtsService.synthesizeSpeech(text, validLang);

        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length,
            'Cache-Control': 'public, max-age=86400'
        });

        return res.send(audioBuffer);
    } catch (error) {
        console.error('Farmer AI TTS Error:', error.message);
        return res.status(502).json({
            success: false,
            message: 'Audio synthesis currently unavailable. Please rely on written output.'
        });
    }
};

// ----------------------------------------------------------------
// 5. Market Intelligence & APMC Benchmarks
// ----------------------------------------------------------------
const getMarketIntelligence = async (req, res) => {
    try {
        const cropQuery = req.query.crop || 'wheat';
        const state = req.query.state || req.user?.profile?.state || 'Maharashtra';

        const intel = MarketDataService.getCropIntelligence(cropQuery);
        const regionalComparison = MarketDataService.compareRegionalDemand(cropQuery, state);

        return res.status(200).json({
            success: true,
            data: {
                crop: intel,
                regionalComparison
            }
        });
    } catch (error) {
        console.error('Farmer AI Market Intelligence Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve agricultural market intelligence.'
        });
    }
};

// ----------------------------------------------------------------
// 6. Mathematical Crop Profit Calculator
// ----------------------------------------------------------------
const calculateProfit = async (req, res) => {
    try {
        const {
            quantity,
            sellingPrice,
            productionCost = 0,
            transportCost = 0,
            handlingCost = 0,
            otherExpenses = 0,
            quantityUnit = 'quintal',
            cropName = 'Crop'
        } = req.body || {};

        if (quantity === undefined || sellingPrice === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Quantity and selling price are required to calculate estimated profit.'
            });
        }

        const calculation = MarketDataService.calculateProfit({
            quantity,
            sellingPrice,
            productionCost,
            transportCost,
            handlingCost,
            otherExpenses,
            quantityUnit,
            cropName
        });

        if (!calculation.valid) {
            return res.status(400).json({
                success: false,
                message: calculation.message
            });
        }

        return res.status(200).json({
            success: true,
            data: calculation
        });
    } catch (error) {
        console.error('Farmer AI Profit Calculation Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to compute profit analysis.'
        });
    }
};

// ----------------------------------------------------------------
// 7. Guided Onboarding Persistence
// ----------------------------------------------------------------
const updateOnboarding = async (req, res) => {
    try {
        const { completed = true } = req.body || {};

        if (typeof completed !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'Completed parameter must be a boolean.'
            });
        }

        await UserModel.updateProfile(req.user.id, {
            ai_onboarding_completed: completed
        }).catch((err) => {
            // Log but don't fail if column is not yet present on older schema
            console.warn('Updating ai_onboarding_completed on profile non-fatal:', err.message);
        });

        return res.status(200).json({
            success: true,
            message: 'AI onboarding status updated successfully.',
            data: { ai_onboarding_completed: completed }
        });
    } catch (error) {
        console.error('Farmer AI Onboarding update error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to update onboarding status.'
        });
    }
};

module.exports = {
    askAi,
    analyzeCrop,
    transcribeAudio,
    getTtsAudio,
    getMarketIntelligence,
    calculateProfit,
    updateOnboarding
};
