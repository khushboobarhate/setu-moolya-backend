const assert = require("node:assert/strict");
const { test, describe, beforeEach } = require("node:test");
const { v4: uuidv4 } = require("uuid");

const farmerAiController = require("../src/controllers/farmerAiController");
const callRequestController = require("../src/controllers/callRequestController");
const { UserModel, ROLES } = require("../src/models/userModel");
const { CropModel } = require("../src/models/cropModel");
const { CallModel } = require("../src/models/callModel");
const { CallRequestModel } = require("../src/models/callRequestModel");
const { MarketDataService } = require("../src/services/marketDataService");
const { GroqService } = require("../src/services/groqService");

const responseRecorder = () => ({
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    },
    set(headers) {
        this.headers = { ...this.headers, ...headers };
        return this;
    },
    send(payload) {
        this.body = payload;
        return this;
    }
});

describe("SetuMoolya Farmer AI Agent & Buyer-Farmer Call Approval System Tests", () => {
    const farmerId = uuidv4();
    const buyerId = uuidv4();
    const otherBuyerId = uuidv4();
    const cropId = uuidv4();

    const mockFarmer = {
        id: farmerId,
        full_name: "Santosh Patil (Farmer)",
        role: ROLES.FARMER,
        email: "santosh@setumoolya.com",
        mobile_number: "+919876543210",
        phone: "+919876543210",
        city: "Nashik",
        state: "Maharashtra",
        is_approved: true
    };

    const mockBuyer = {
        id: buyerId,
        full_name: "Sahyadri Agro Processing (Buyer)",
        role: ROLES.BUYER,
        email: "procurement@sahyadriagro.com",
        mobile_number: "+919123456789",
        phone: "+919123456789",
        city: "Pune",
        state: "Maharashtra",
        is_approved: true
    };

    const mockOtherBuyer = {
        id: otherBuyerId,
        full_name: "Northern Mills Ltd",
        role: ROLES.BUYER,
        email: "procure@northernmills.com",
        mobile_number: "+919888777666",
        phone: "+919888777666",
        city: "Delhi",
        state: "Delhi",
        is_approved: true
    };

    const mockCrop = {
        id: cropId,
        farmer_id: farmerId,
        crop_name: "Organic Sharbati Wheat",
        crop_type: "organic",
        quantity: 50,
        quantity_unit: "quintal",
        price: 2600,
        description: "Freshly harvested premium grade wheat",
        status: "available",
        photos: ["wheat1.jpg"]
    };

    beforeEach(async () => {
        // Setup mock user & crop lookups
        UserModel.findById = async (id) => {
            if (id === farmerId) return mockFarmer;
            if (id === buyerId) return mockBuyer;
            if (id === otherBuyerId) return mockOtherBuyer;
            return null;
        };

        CropModel.findById = async (id) => {
            if (id === cropId) return mockCrop;
            return null;
        };

        await CallModel.setUserAvailability(farmerId, true);
        await CallModel.setUserAvailability(buyerId, true);
    });

    // ================================================================
    // PART 1: FARMER AI AGENT TESTS
    // ================================================================

    test("Farmer can ask agricultural questions in English, Hindi, Gujarati, and Marathi", async () => {
        const testLanguages = ["en", "hi", "gu", "mr"];

        for (const lang of testLanguages) {
            const req = {
                user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
                body: { message: "What is the best fertilizer for wheat?", language: lang }
            };
            const res = responseRecorder();

            await farmerAiController.askAi(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(res.body.success, true);
            assert.ok(res.body.data.reply, `Expected reply for language ${lang}`);
            assert.equal(res.body.data.language, lang);
        }
    });

    test("Farmer AI rejects empty question queries", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
            body: { message: "   " }
        };
        const res = responseRecorder();

        await farmerAiController.askAi(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
    });

    test("Farmer can analyze a crop photograph with uncertainty disclaimer", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
            file: {
                buffer: Buffer.from("fake-crop-image-bytes"),
                mimetype: "image/jpeg"
            },
            body: { language: "hi" }
        };
        const res = responseRecorder();

        await farmerAiController.analyzeCrop(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.ok(res.body.data.analysis);
        assert.ok(res.body.data.disclaimer);
    });

    test("Farmer AI rejects crop image analysis when no file is uploaded", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
            file: null,
            body: {}
        };
        const res = responseRecorder();

        await farmerAiController.analyzeCrop(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
    });

    test("Farmer can transcribe voice recording to text", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
            file: {
                buffer: Buffer.from("fake-audio-bytes"),
                mimetype: "audio/webm",
                originalname: "question.webm"
            },
            body: { language: "hi" }
        };
        const res = responseRecorder();

        await farmerAiController.transcribeAudio(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.ok(res.body.data.text);
    });

    test("Market intelligence service returns verified APMC benchmarks, buyers and applications", async () => {
        const crops = ["wheat", "soybean", "cotton", "tomato", "onion", "maize"];

        for (const c of crops) {
            const req = {
                user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
                query: { crop: c, state: "Maharashtra" }
            };
            const res = responseRecorder();

            await farmerAiController.getMarketIntelligence(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(res.body.success, true);
            const { crop, regionalComparison } = res.body.data;
            assert.ok(crop.name);
            assert.ok(crop.applications.length > 0);
            assert.ok(crop.buyers.length > 0);
            assert.ok(crop.markets.length > 0);
            assert.ok(regionalComparison.length > 0);
        }
    });

    test("Profit calculation accurately applies the net profit formula", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
            body: {
                cropName: "Wheat",
                quantity: 100, // 100 quintals
                sellingPrice: 2500, // ₹2500/quintal -> Revenue = ₹250,000
                productionCost: 120000,
                transportCost: 8000,
                handlingCost: 2000,
                otherExpenses: 5000 // Total expenses = ₹135,000
            }
        };
        const res = responseRecorder();

        await farmerAiController.calculateProfit(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        const data = res.body.data;
        assert.equal(data.grossRevenue, 250000);
        assert.equal(data.expensesBreakdown.totalExpenses, 135000);
        assert.equal(data.netProfit, 115000); // 250,000 - 135,000
        assert.equal(data.profitMarginPercent, 46); // 115,000 / 250,000 * 100 = 46%
        assert.equal(data.healthEvaluation, "Excellent");
    });

    test("Profit calculation rejects invalid negative quantity or non-numeric inputs", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
            body: { quantity: -10, sellingPrice: 2000 }
        };
        const res = responseRecorder();

        await farmerAiController.calculateProfit(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
    });

    test("Farmer can update AI onboarding completion flag", async () => {
        UserModel.updateProfile = async (id, updates) => ({ id, ...updates });

        const req = {
            user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
            body: { completed: true }
        };
        const res = responseRecorder();

        await farmerAiController.updateOnboarding(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.ai_onboarding_completed, true);
    });

    // ================================================================
    // PART 2: BUYER-FARMER CALL REQUEST & APPROVAL SYSTEM
    // ================================================================

    test("Buyer can submit a call request; farmer phone remains hidden before approval", async () => {
        const req = {
            user: { id: buyerId, role: ROLES.BUYER, profile: mockBuyer },
            body: { farmer_id: farmerId, crop_id: cropId, buyer_note: "Interested in bulk procurement" }
        };
        const res = responseRecorder();

        await callRequestController.buyerCreateCallRequest(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.status, "pending");
        assert.equal(res.body.data.buyer_id, buyerId);
        assert.equal(res.body.data.farmer_id, farmerId);
        // Ensure farmer phone is not revealed in the creation response
        assert.equal(res.body.data.phone, undefined);
    });

    test("Buyer cannot submit duplicate pending request to same farmer", async () => {
        const req = {
            user: { id: buyerId, role: ROLES.BUYER, profile: mockBuyer },
            body: { farmer_id: farmerId, crop_id: cropId }
        };
        const res = responseRecorder();

        await callRequestController.buyerCreateCallRequest(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.success, false);
    });

    test("Buyer cannot request call if farmer call availability is OFF", async () => {
        await CallModel.setUserAvailability(farmerId, false);

        const req = {
            user: { id: otherBuyerId, role: ROLES.BUYER, profile: mockOtherBuyer },
            body: { farmer_id: farmerId, crop_id: cropId }
        };
        const res = responseRecorder();

        await callRequestController.buyerCreateCallRequest(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.success, false);
        assert.equal(res.body.call_permitted, false);

        // Restore availability
        await CallModel.setUserAvailability(farmerId, true);
    });

    test("Farmer can list incoming call requests with pending count for badge", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, profile: mockFarmer },
            query: {}
        };
        const res = responseRecorder();

        await callRequestController.farmerListCallRequests(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.ok(Array.isArray(res.body.data.requests));
        assert.ok(res.body.data.pendingCount >= 1);
    });

    test("Farmer approves call request; phone becomes visible to buyer", async () => {
        // Find the pending request
        const pendingList = await CallRequestModel.listForFarmer(farmerId, { status: "pending" });
        assert.ok(pendingList.length > 0);
        const targetRequest = pendingList[0];

        // Farmer approves
        const approveReq = {
            user: { ...mockFarmer, id: farmerId, role: ROLES.FARMER },
            params: { id: targetRequest.id }
        };
        const approveRes = responseRecorder();

        await callRequestController.farmerApproveCallRequest(approveReq, approveRes);

        assert.equal(approveRes.statusCode, 200);
        assert.equal(approveRes.body.success, true);
        assert.equal(approveRes.body.data.status, "approved");

        // Now buyer retrieves the call request detail -> phone is revealed
        const buyerReq = {
            user: { id: targetRequest.buyer_id, role: ROLES.BUYER, profile: mockBuyer },
            params: { id: targetRequest.id }
        };
        const buyerRes = responseRecorder();

        await callRequestController.buyerGetCallRequestDetail(buyerReq, buyerRes);

        assert.equal(buyerRes.statusCode, 200);
        assert.equal(buyerRes.body.success, true);
        assert.equal(buyerRes.body.data.status, "approved");
        assert.equal(buyerRes.body.data.farmer.phone, mockFarmer.mobile_number);
    });

    test("Farmer rejects a call request; phone remains completely hidden", async () => {
        // Create a new request from otherBuyerId
        const newReq = await CallRequestModel.createRequest({
            buyer_id: otherBuyerId,
            farmer_id: farmerId,
            crop_id: cropId
        });

        // Farmer rejects
        const rejectReq = {
            user: { ...mockFarmer, id: farmerId, role: ROLES.FARMER },
            params: { id: newReq.id },
            body: { rejection_reason: "Currently not selling in bulk" }
        };
        const rejectRes = responseRecorder();

        await callRequestController.farmerRejectCallRequest(rejectReq, rejectRes);

        assert.equal(rejectRes.statusCode, 200);
        assert.equal(rejectRes.body.success, true);
        assert.equal(rejectRes.body.data.status, "rejected");

        // Buyer checks request detail -> phone must NOT be present
        const buyerReq = {
            user: { id: otherBuyerId, role: ROLES.BUYER, profile: mockOtherBuyer },
            params: { id: newReq.id }
        };
        const buyerRes = responseRecorder();

        await callRequestController.buyerGetCallRequestDetail(buyerReq, buyerRes);

        assert.equal(buyerRes.statusCode, 200);
        assert.equal(buyerRes.body.success, true);
        assert.equal(buyerRes.body.data.status, "rejected");
        assert.equal(buyerRes.body.data.farmer.phone, undefined);
    });

    test("Repeated approval or rejection on an already processed request is rejected", async () => {
        const list = await CallRequestModel.listForFarmer(farmerId);
        const processed = list.find((r) => r.status !== "pending");
        assert.ok(processed);

        const req = {
            user: { ...mockFarmer, id: farmerId, role: ROLES.FARMER },
            params: { id: processed.id }
        };
        const res = responseRecorder();

        await callRequestController.farmerApproveCallRequest(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
    });
});
