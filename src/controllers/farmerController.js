const { supabase, supabaseAdmin, isConfigured } = require("../config/supabase");
const { UserModel, ROLES } = require("../models/userModel");
const { CropModel } = require("../models/cropModel");
const { InterestModel } = require("../models/interestModel");
const { CallModel } = require("../models/callModel");
require("dotenv").config();

/**
 * Validate the phone_verified_token issued after OTP verification
 */
const validatePhoneToken = (token, expectedPhone) => {
    try {
        const jwt = require("jsonwebtoken");
        const secret = process.env.JWT_SECRET || "setumoolya-otp-secret";
        const decoded = jwt.verify(token, secret);
        if (decoded.purpose !== "otp_verified") return { valid: false, message: "Invalid token purpose." };
        if (decoded.phone !== expectedPhone) return { valid: false, message: "Phone mismatch in token." };
        return { valid: true, decoded };
    } catch (err) {
        return { valid: false, message: err.message };
    }
};

// ================================================================
// Controller: Farmer Registration
// ================================================================

/**
 * @route   POST /api/farmer/register
 * @desc    Submit a new farmer registration request (after OTP verification)
 * @access  Public
 */
const farmerRegister = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({
                success: false,
                message: "Database service not configured."
            });
        }

        const {
            full_name,
            age,
            mobile_number,
            nationality,
            state,
            taluka,
            city,
            full_address,
            land_location,
            preferred_language,
            phone_verified_token
        } = req.body;

        // -- Required field validation --
        const required = { full_name, age, mobile_number, nationality, state, taluka, city, full_address, land_location, preferred_language, phone_verified_token };
        const missing = Object.entries(required)
            .filter(([, v]) => !v || v.toString().trim() === "")
            .map(([k]) => k);

        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(", ")}`
            });
        }

        // -- Validate phone_verified_token --
        const tokenCheck = validatePhoneToken(phone_verified_token, mobile_number);
        if (!tokenCheck.valid) {
            return res.status(400).json({
                success: false,
                message: `Mobile number not verified. ${tokenCheck.message} Please complete OTP verification first.`
            });
        }

        // -- Photograph required --
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Passport-size photograph is required."
            });
        }

        // Build the photo URL
        const photoUrl = `/uploads/photos/${req.file.filename}`;

        // -- Persist registration request --
        const requestPayload = {
            role: ROLES.FARMER,
            full_name: full_name.trim(),
            age: parseInt(age),
            mobile_number: mobile_number.trim(),
            nationality: nationality.trim(),
            state: state.trim(),
            taluka: taluka.trim(),
            city: city.trim(),
            full_address: full_address.trim(),
            land_location: land_location.trim(),
            preferred_language: preferred_language.trim(),
            photo_url: photoUrl,
            status: "pending",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const registrationRequest = await UserModel.createRegistrationRequest(requestPayload);
        const confirmationMsg = getRegistrationConfirmationMessage(preferred_language);

        return res.status(201).json({
            success: true,
            message: confirmationMsg,
            data: {
                request_id: registrationRequest.id,
                role: ROLES.FARMER,
                full_name: registrationRequest.full_name,
                photo_url: photoUrl,
                status: registrationRequest.status,
                preferred_language: registrationRequest.preferred_language
            }
        });
    } catch (error) {
        console.error("Farmer Register Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to submit farmer registration.",
            error: error.message
        });
    }
};

// ================================================================
// Controller: Farmer Login
// ================================================================

/**
 * @route   POST /api/farmer/login
 * @desc    Existing approved farmer login with credentials provided via email
 * @access  Public
 */
const farmerLogin = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({ success: false, message: "Database service not configured." });
        }

        const { login_id, password } = req.body;
        if (!login_id || !password) {
            return res.status(400).json({ success: false, message: "login_id (email) and password are required." });
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email: login_id, password });
        if (error) {
            return res.status(401).json({ success: false, message: "Invalid login credentials.", error: error.message });
        }

        const profile = await UserModel.findById(data.user.id);
        if (!profile || profile.role !== ROLES.FARMER) {
            return res.status(403).json({ success: false, message: "Access denied. This login is for Farmers only." });
        }

        if (!profile.is_approved) {
            return res.status(403).json({
                success: false,
                message: "Your account has not been approved yet. Please wait for Admin approval."
            });
        }

        const is_call_available = await CallModel.getUserAvailability(data.user.id);

        return res.status(200).json({
            success: true,
            message: "Farmer login successful.",
            data: {
                token: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresIn: data.session.expires_in,
                user: {
                    id: data.user.id,
                    login_id: data.user.email,
                    role: profile.role,
                    full_name: profile.full_name,
                    photo_url: profile.photo_url,
                    preferred_language: profile.preferred_language,
                    state: profile.state,
                    city: profile.city,
                    is_call_available
                }
            }
        });
    } catch (error) {
        console.error("Farmer Login Error:", error);
        return res.status(500).json({ success: false, message: "An error occurred during login.", error: error.message });
    }
};

// ================================================================
// Controller: Farmer Profile
// ================================================================

/**
 * @route   GET /api/farmer/profile
 * @desc    Get authenticated farmer's profile including call availability
 * @access  Protected (Farmer)
 */
const getFarmerProfile = async (req, res) => {
    try {
        const profile = await UserModel.findById(req.user.id);
        if (!profile) {
            return res.status(404).json({ success: false, message: "Farmer profile not found." });
        }
        const is_call_available = await CallModel.getUserAvailability(req.user.id);
        return res.status(200).json({
            success: true,
            data: {
                ...profile,
                is_call_available
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch farmer profile.", error: error.message });
    }
};

// ================================================================
// Controller: Farmer Call Availability
// ================================================================

/**
 * @route   GET /api/farmer/availability
 * @desc    Get farmer's current call availability status
 * @access  Protected (Farmer)
 */
const getCallAvailability = async (req, res) => {
    try {
        const isAvailable = await CallModel.getUserAvailability(req.user.id);
        return res.status(200).json({
            success: true,
            data: {
                farmer_id: req.user.id,
                is_call_available: isAvailable,
                status: isAvailable ? "ON" : "OFF"
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to get call availability.", error: error.message });
    }
};

/**
 * @route   PATCH /api/farmer/availability
 * @desc    Toggle or set farmer's call availability ON or OFF
 * @access  Protected (Farmer)
 * @body    { is_call_available: boolean } or { status: "ON"|"OFF" }
 */
const setCallAvailability = async (req, res) => {
    try {
        let isAvailable;
        if (typeof req.body.is_call_available !== "undefined") {
            isAvailable = String(req.body.is_call_available).toLowerCase() === "true" || req.body.is_call_available === true;
        } else if (typeof req.body.status !== "undefined") {
            isAvailable = String(req.body.status).toUpperCase() === "ON";
        } else if (typeof req.body.availability !== "undefined") {
            isAvailable = String(req.body.availability).toUpperCase() === "ON" || req.body.availability === true;
        } else {
            return res.status(400).json({
                success: false,
                message: "Please provide is_call_available (boolean) or status ('ON'/'OFF')."
            });
        }

        const updated = await CallModel.setUserAvailability(req.user.id, isAvailable);
        return res.status(200).json({
            success: true,
            message: `Farmer call availability turned ${updated ? "ON" : "OFF"} successfully.`,
            data: {
                farmer_id: req.user.id,
                is_call_available: updated,
                status: updated ? "ON" : "OFF"
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to update call availability.", error: error.message });
    }
};

// ================================================================
// Controller: Farmer Crop Upload & Management
// ================================================================

/**
 * @route   POST /api/farmer/crops
 * @desc    Upload a new crop listing with photos, quantity, crop type, required price, description
 * @access  Protected (Farmer)
 */
const uploadCrop = async (req, res) => {
    try {
        const {
            crop_name,
            name,
            title,
            crop_type,
            quantity,
            quantity_unit = "kg",
            price,
            required_price,
            description
        } = req.body;

        const cropNameFinal = (crop_name || name || title || "").trim();
        const priceFinal = price !== undefined ? price : required_price;

        if (!cropNameFinal) {
            return res.status(400).json({ success: false, message: "Crop name is required." });
        }
        if (!crop_type) {
            return res.status(400).json({ success: false, message: "Crop type (organic or inorganic) is required." });
        }
        const normType = crop_type.toLowerCase();
        if (!["organic", "inorganic", "non-organic"].includes(normType)) {
            return res.status(400).json({
                success: false,
                message: "Crop type must be either 'organic' or 'inorganic' (non-organic)."
            });
        }
        if (quantity === undefined || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
            return res.status(400).json({ success: false, message: "A valid positive crop quantity is required." });
        }
        if (priceFinal === undefined || isNaN(parseFloat(priceFinal)) || parseFloat(priceFinal) < 0) {
            return res.status(400).json({ success: false, message: "A valid required price is required." });
        }

        // Process uploaded photos
        const photoUrls = [];
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
            req.files.forEach((f) => photoUrls.push(`/uploads/crops/${f.filename}`));
        } else if (req.files && typeof req.files === "object") {
            const fileList = req.files.photos || req.files.photo || [];
            fileList.forEach((f) => photoUrls.push(`/uploads/crops/${f.filename}`));
        } else if (req.file) {
            photoUrls.push(`/uploads/crops/${req.file.filename}`);
        } else if (req.body.photos) {
            // Support passing pre-uploaded photo URL(s)
            if (Array.isArray(req.body.photos)) {
                photoUrls.push(...req.body.photos);
            } else if (typeof req.body.photos === "string") {
                try {
                    const parsed = JSON.parse(req.body.photos);
                    if (Array.isArray(parsed)) photoUrls.push(...parsed);
                    else photoUrls.push(req.body.photos);
                } catch {
                    photoUrls.push(req.body.photos);
                }
            }
        }

        const crop = await CropModel.createCrop({
            farmer_id: req.user.id,
            crop_name: cropNameFinal,
            crop_type: normType,
            quantity: parseFloat(quantity),
            quantity_unit: quantity_unit || "kg",
            price: parseFloat(priceFinal),
            description: (description || "").trim(),
            photos: photoUrls
        });

        return res.status(201).json({
            success: true,
            message: "Crop listing uploaded successfully.",
            data: crop
        });
    } catch (error) {
        console.error("Upload Crop Error:", error);
        return res.status(500).json({ success: false, message: "Failed to upload crop.", error: error.message });
    }
};

/**
 * @route   GET /api/farmer/crops
 * @desc    Get all crops uploaded by the logged-in farmer, with interested buyers and rating summary
 * @access  Protected (Farmer)
 */
const getMyCrops = async (req, res) => {
    try {
        const crops = await CropModel.findByFarmerId(req.user.id);

        // Enrich each crop with interested buyers and average rating
        const enriched = await Promise.all(
            crops.map(async (c) => {
                const interests = await InterestModel.findByCropId(c.id);
                const ratingSummary = await InterestModel.getRatingSummary(c.id);
                return {
                    ...c,
                    interested_buyers_count: interests.length,
                    average_rating: ratingSummary.average_rating,
                    total_ratings: ratingSummary.total_ratings,
                    interested_buyers: interests
                };
            })
        );

        return res.status(200).json({
            success: true,
            message: `Fetched ${enriched.length} crop listing(s).`,
            data: enriched
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch farmer crops.", error: error.message });
    }
};

/**
 * @route   GET /api/farmer/crops/:cropId
 * @desc    Get a single crop detail with its interested buyers and ratings
 * @access  Protected (Farmer)
 */
const getCropDetail = async (req, res) => {
    try {
        const { cropId } = req.params;
        const crop = await CropModel.findById(cropId);
        if (!crop || crop.farmer_id !== req.user.id) {
            return res.status(404).json({ success: false, message: "Crop not found or unauthorized access." });
        }

        const interests = await InterestModel.findByCropId(cropId);
        const ratingSummary = await InterestModel.getRatingSummary(cropId);

        return res.status(200).json({
            success: true,
            data: {
                ...crop,
                interested_buyers_count: interests.length,
                average_rating: ratingSummary.average_rating,
                total_ratings: ratingSummary.total_ratings,
                interested_buyers: interests
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch crop detail.", error: error.message });
    }
};

/**
 * @route   DELETE /api/farmer/crops/:cropId
 * @desc    Delete a crop listing
 * @access  Protected (Farmer)
 */
const deleteCrop = async (req, res) => {
    try {
        const { cropId } = req.params;
        const deleted = await CropModel.deleteCrop(cropId, req.user.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Crop listing not found or unauthorized." });
        }
        return res.status(200).json({ success: true, message: "Crop listing deleted successfully." });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to delete crop.", error: error.message });
    }
};

// ================================================================
// Controller: View Buyer Interests & Ratings
// ================================================================

/**
 * @route   GET /api/farmer/interests
 * @desc    View all buyers who have expressed interest in the farmer's crops with ratings
 * @access  Protected (Farmer)
 */
const getFarmerInterests = async (req, res) => {
    try {
        const { cropId } = req.query;
        const farmerCrops = await CropModel.findByFarmerId(req.user.id);
        const relevantCrops = cropId
            ? farmerCrops.filter((c) => c.id === cropId)
            : farmerCrops;

        const allInterests = [];
        for (const crop of relevantCrops) {
            const interests = await InterestModel.findByCropId(crop.id);
            for (const item of interests) {
                allInterests.push({
                    interest_id: item.id,
                    crop_id: crop.id,
                    crop_name: crop.crop_name,
                    crop_type: crop.crop_type,
                    rating: item.rating,
                    notes: item.notes,
                    created_at: item.created_at,
                    buyer: item.buyer
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: `Found ${allInterests.length} buyer interest record(s).`,
            data: allInterests
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch buyer interests.", error: error.message });
    }
};

// ================================================================
// Controller: Farmer-to-Buyer Calling
// ================================================================

/**
 * @route   POST /api/farmer/calls/initiate
 * @desc    Farmer calls a buyer who has expressed interest in their crops.
 *          Call is permitted ONLY if:
 *          1. The buyer has expressed interest in the farmer's crop(s).
 *          2. The buyer's call availability is ON.
 * @access  Protected (Farmer)
 * @body    { buyer_id: UUID, crop_id?: UUID }
 */
const callBuyer = async (req, res) => {
    try {
        const { buyer_id, crop_id } = req.body;
        if (!buyer_id) {
            return res.status(400).json({ success: false, message: "buyer_id is required." });
        }

        const buyer = await UserModel.findById(buyer_id);
        if (!buyer || buyer.role !== ROLES.BUYER) {
            return res.status(404).json({ success: false, message: "Buyer profile not found." });
        }

        // 1. Verify buyer has expressed interest in this farmer's crop
        let hasInterest = false;
        if (crop_id) {
            const crop = await CropModel.findById(crop_id);
            if (!crop || crop.farmer_id !== req.user.id) {
                return res.status(400).json({ success: false, message: "Specified crop does not belong to you." });
            }
            hasInterest = await InterestModel.hasExpressedInterest(crop_id, buyer_id);
        } else {
            hasInterest = await InterestModel.hasInterestInFarmerCrops(req.user.id, buyer_id);
        }

        if (!hasInterest) {
            await CallModel.logCall({
                caller_id: req.user.id,
                receiver_id: buyer_id,
                crop_id: crop_id || null,
                caller_role: ROLES.FARMER,
                receiver_role: ROLES.BUYER,
                status: "blocked_no_interest"
            });

            return res.status(403).json({
                success: false,
                call_permitted: false,
                message: "You can only call buyers who have expressed interest in your crops."
            });
        }

        // 2. Check receiving buyer's call availability status
        const isBuyerAvailable = await CallModel.getUserAvailability(buyer_id);
        if (!isBuyerAvailable) {
            await CallModel.logCall({
                caller_id: req.user.id,
                receiver_id: buyer_id,
                crop_id: crop_id || null,
                caller_role: ROLES.FARMER,
                receiver_role: ROLES.BUYER,
                status: "blocked_receiver_unavailable"
            });

            return res.status(403).json({
                success: false,
                call_permitted: false,
                message: "Buyer is currently not available to receive calls. Call availability is turned OFF.",
                data: {
                    receiver_id: buyer_id,
                    receiver_name: buyer.full_name,
                    is_call_available: false
                }
            });
        }

        // 3. Receiver availability is ON -> Permit call & reveal contact number
        const buyerPhone = buyer.mobile_number || buyer.phone;
        const callLog = await CallModel.logCall({
            caller_id: req.user.id,
            receiver_id: buyer_id,
            crop_id: crop_id || null,
            caller_role: ROLES.FARMER,
            receiver_role: ROLES.BUYER,
            status: "permitted",
            phone_revealed: buyerPhone
        });

        return res.status(200).json({
            success: true,
            call_permitted: true,
            message: "Buyer is available. Call initiated successfully.",
            data: {
                call_id: callLog.id,
                receiver_id: buyer.id,
                receiver_name: buyer.full_name,
                receiver_phone: buyerPhone,
                receiver_role: ROLES.BUYER,
                receiver_availability: "ON",
                crop_id: crop_id || null,
                call_status: "permitted"
            }
        });
    } catch (error) {
        console.error("Farmer Call Buyer Error:", error);
        return res.status(500).json({ success: false, message: "Failed to initiate call.", error: error.message });
    }
};

// ================================================================
// Utility: Registration Confirmation Messages by Language
// ================================================================

const getRegistrationConfirmationMessage = (language) => {
    const messages = {
        en: "Your registration request has been sent to the Admin Portal. It will be verified within 24 hours.",
        hi: "आपका पंजीकरण अनुरोध व्यवस्थापक पोर्टल पर भेज दिया गया है। इसे 24 घंटों के भीतर सत्यापित किया जाएगा।",
        mr: "तुमचा नोंदणी अर्ज प्रशासक पोर्टलवर पाठवण्यात आला आहे. तो 24 तासांच्या आत सत्यापित केला जाईल.",
        gu: "તમારી નોંધણી વિનંતી એડમિન પોર્ટલ પર મોકલવામાં આવી છે. તે 24 કલાકની અંદર ચકાસવામાં આવશે.",
        ta: "உங்கள் பதிவு கோரிக்கை நிர்வாகி போர்ட்டலுக்கு அனுப்பப்பட்டது. அது 24 மணி நேரத்தில் சரிபார்க்கப்படும்.",
        te: "మీ నమోదు అభ్యర్థన అడ్మిన్ పోర్టల్‌కు పంపబడింది. ఇది 24 గంటల్లో ధృవీకరించబడుతుంది.",
        kn: "ನಿಮ್ಮ ನೋಂದಣಿ ವಿನಂತಿಯನ್ನು ನಿರ್ವಾಹಕ ಪೋರ್ಟಲ್‌ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ. ಇದನ್ನು 24 ಗಂಟೆಗಳಲ್ಲಿ ಪರಿಶೀಲಿಸಲಾಗುವುದು.",
        bn: "আপনার নিবন্ধন অনুরোধ অ্যাডমিন পোর্টালে পাঠানো হয়েছে। এটি ২৪ ঘণ্টার মধ্যে যাচাই করা হবে।",
        pa: "ਤੁਹਾਡੀ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਬੇਨਤੀ ਪ੍ਰਬੰਧਕ ਪੋਰਟਲ ਤੇ ਭੇਜੀ ਗਈ ਹੈ। ਇਸਨੂੰ 24 ਘੰਟਿਆਂ ਵਿੱਚ ਜਾਂਚਿਆ ਜਾਵੇਗਾ।",
        ml: "നിങ്ങളുടെ രജിസ്ട്രേഷൻ അഭ്യർത്ഥന അഡ്മിൻ പോർട്ടലിലേക്ക് അയച്ചു. ഇത് 24 മണിക്കൂറിനുള്ളിൽ പരിശോധിക്കും.",
        or: "ଆପଣଙ୍କ ପଞ୍ଜୀକରଣ ଅନୁରୋଧ ଆଡ୍ମିନ ପୋର୍ଟାଲକୁ ପଠାଯାଇଛି। ଏହା 24 ଘଣ୍ଟା ମଧ୍ୟରେ ଯାଞ୍ଚ ହେବ।",
        ur: "آپ کی رجسٹریشن کی درخواست ایڈمن پورٹل پر بھیج دی گئی ہے۔ اسے 24 گھنٹوں میں تصدیق کیا جائے گا۔",
        as: "আপোনাৰ পঞ্জীয়ন অনুৰোধ প্ৰশাসক পোৰ্টেললৈ পঠোৱা হৈছে। ই ২৪ ঘণ্টাৰ ভিতৰত যাচাই কৰা হ'ব।"
    };

    const langCode = (language || "en").toLowerCase().split("-")[0];
    return messages[langCode] || messages["en"];
};

module.exports = {
    farmerRegister,
    farmerLogin,
    getFarmerProfile,
    getCallAvailability,
    setCallAvailability,
    uploadCrop,
    getMyCrops,
    getCropDetail,
    deleteCrop,
    getFarmerInterests,
    callBuyer,
    getRegistrationConfirmationMessage
};
