const { supabase, supabaseAdmin, isConfigured } = require("../config/supabase");
const { UserModel, ROLES } = require("../models/userModel");
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
 * @body    FormData: full_name, age, mobile_number, nationality, state, taluka,
 *          city, full_address, land_location, preferred_language,
 *          phone_verified_token
 * @files   photo (passport-size photograph)
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

        // Build the photo URL (relative path served as static file)
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

        // -- Build confirmation message in selected language --
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
 * @body    { login_id: "email@example.com", password: "..." }
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
                    city: profile.city
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
 * @desc    Get authenticated farmer's profile
 * @access  Protected (Farmer)
 */
const getFarmerProfile = async (req, res) => {
    try {
        const profile = await UserModel.findById(req.user.id);
        if (!profile) {
            return res.status(404).json({ success: false, message: "Farmer profile not found." });
        }
        return res.status(200).json({ success: true, data: profile });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch farmer profile.", error: error.message });
    }
};

// ================================================================
// Utility: Registration Confirmation Messages by Language
// ================================================================

/**
 * Returns the registration confirmation message in the user's preferred language.
 * Language codes follow ISO 639-1 convention.
 */
const getRegistrationConfirmationMessage = (language) => {
    const messages = {
        // English
        en: "Your registration request has been sent to the Admin Portal. It will be verified within 24 hours.",
        // Hindi
        hi: "आपका पंजीकरण अनुरोध व्यवस्थापक पोर्टल पर भेज दिया गया है। इसे 24 घंटों के भीतर सत्यापित किया जाएगा।",
        // Marathi
        mr: "तुमचा नोंदणी अर्ज प्रशासक पोर्टलवर पाठवण्यात आला आहे. तो 24 तासांच्या आत सत्यापित केला जाईल.",
        // Gujarati
        gu: "તમારી નોંધણી વિનંતી એડમિન પોર્ટલ પર મોકલવામાં આવી છે. તે 24 કલાકની અંદર ચકાસવામાં આવશે.",
        // Tamil
        ta: "உங்கள் பதிவு கோரிக்கை நிர்வாகி போர்ட்டலுக்கு அனுப்பப்பட்டது. அது 24 மணி நேரத்தில் சரிபார்க்கப்படும்.",
        // Telugu
        te: "మీ నమోదు అభ్యర్థన అడ్మిన్ పోర్టల్‌కు పంపబడింది. ఇది 24 గంటల్లో ధృవీకరించబడుతుంది.",
        // Kannada
        kn: "ನಿಮ್ಮ ನೋಂದಣಿ ವಿನಂತಿಯನ್ನು ನಿರ್ವಾಹಕ ಪೋರ್ಟಲ್‌ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ. ಇದನ್ನು 24 ಗಂಟೆಗಳಲ್ಲಿ ಪರಿಶೀಲಿಸಲಾಗುವುದು.",
        // Bengali
        bn: "আপনার নিবন্ধন অনুরোধ অ্যাডমিন পোর্টালে পাঠানো হয়েছে। এটি ২৪ ঘণ্টার মধ্যে যাচাই করা হবে।",
        // Punjabi
        pa: "ਤੁਹਾਡੀ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਬੇਨਤੀ ਪ੍ਰਬੰਧਕ ਪੋਰਟਲ ਤੇ ਭੇਜੀ ਗਈ ਹੈ। ਇਸਨੂੰ 24 ਘੰਟਿਆਂ ਵਿੱਚ ਜਾਂਚਿਆ ਜਾਵੇਗਾ।",
        // Malayalam
        ml: "നിങ്ങളുടെ രജിസ്ട്രേഷൻ അഭ്യർത്ഥന അഡ്മിൻ പോർട്ടലിലേക്ക് അയച്ചു. ഇത് 24 മണിക്കൂറിനുള്ളിൽ പരിശോധിക്കും.",
        // Odia
        or: "ଆପଣଙ୍କ ପଞ୍ଜୀକରଣ ଅନୁରୋଧ ଆଡ୍ମିନ ପୋର୍ଟାଲକୁ ପଠାଯାଇଛି। ଏହା 24 ଘଣ୍ଟା ମଧ୍ୟରେ ଯାଞ୍ଚ ହେବ।",
        // Urdu
        ur: "آپ کی رجسٹریشن کی درخواست ایڈمن پورٹل پر بھیج دی گئی ہے۔ اسے 24 گھنٹوں میں تصدیق کیا جائے گا۔",
        // Assamese
        as: "আপোনাৰ পঞ্জীয়ন অনুৰোধ প্ৰশাসক পোৰ্টেললৈ পঠোৱা হৈছে। ই ২৪ ঘণ্টাৰ ভিতৰত যাচাই কৰা হ'ব।"
    };

    // Normalize language code (take base language if locale like "en-US" is passed)
    const langCode = (language || "en").toLowerCase().split("-")[0];
    return messages[langCode] || messages["en"];
};

module.exports = {
    farmerRegister,
    farmerLogin,
    getFarmerProfile,
    getRegistrationConfirmationMessage
};
