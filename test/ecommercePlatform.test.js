const assert = require("node:assert/strict");
const { test, describe, beforeEach } = require("node:test");
const { v4: uuidv4 } = require("uuid");

const farmerController = require("../src/controllers/farmerController");
const buyerController = require("../src/controllers/buyerController");
const { UserModel, ROLES } = require("../src/models/userModel");
const { CropModel } = require("../src/models/cropModel");
const { InterestModel } = require("../src/models/interestModel");
const { CallModel } = require("../src/models/callModel");

const responseRecorder = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    }
});

describe("Setu Moolya Agricultural E-Commerce & Calling Platform Tests", () => {
    const farmerId = uuidv4();
    const buyerId = uuidv4();
    const uninterestedBuyerId = uuidv4();

    // Mock profiles in UserModel if needed
    const mockFarmer = {
        id: farmerId,
        full_name: "Ramesh Sharma (Farmer)",
        role: ROLES.FARMER,
        email: "ramesh@setumoolya.com",
        mobile_number: "+919876543211",
        phone: "+919876543211",
        city: "Joshimath",
        state: "Uttarakhand",
        is_approved: true
    };

    const mockBuyer = {
        id: buyerId,
        full_name: "Global Botanicals Inc (Buyer)",
        role: ROLES.BUYER,
        email: "buyer@botanicals.com",
        mobile_number: "+919123456780",
        phone: "+919123456780",
        city: "Mumbai",
        state: "Maharashtra",
        is_approved: true
    };

    const mockUninterestedBuyer = {
        id: uninterestedBuyerId,
        full_name: "Other Buyer LLC",
        role: ROLES.BUYER,
        email: "other@buyer.com",
        mobile_number: "+919998887776",
        phone: "+919998887776",
        city: "Delhi",
        state: "Delhi",
        is_approved: true
    };

    // Monkey-patch UserModel.findById for test mock profiles
    const originalFindById = UserModel.findById;
    beforeEach(() => {
        UserModel.findById = async (id) => {
            if (id === farmerId) return mockFarmer;
            if (id === buyerId) return mockBuyer;
            if (id === uninterestedBuyerId) return mockUninterestedBuyer;
            return originalFindById(id);
        };
    });

    // ----------------------------------------------------------------
    // 1. Farmer Crop Upload & Management
    // ----------------------------------------------------------------
    let createdCropId = null;

    test("Farmer uploads a new organic crop listing with photos, quantity, price, and description", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, is_approved: true },
            body: {
                crop_name: "Himalayan Kutki Root",
                crop_type: "organic",
                quantity: "150",
                quantity_unit: "kg",
                price: "5500",
                description: "Wild harvested Himalayan Kutki rhizomes with HPLC verified Picroside content."
            },
            files: [
                { filename: "kutki-sample-1.jpg" },
                { filename: "kutki-sample-2.jpg" }
            ]
        };
        const res = responseRecorder();

        await farmerController.uploadCrop(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.crop_name, "Himalayan Kutki Root");
        assert.equal(res.body.data.crop_type, "organic");
        assert.equal(res.body.data.quantity, 150);
        assert.equal(res.body.data.price, 5500);
        assert.equal(res.body.data.photos.length, 2);
        assert.match(res.body.data.photos[0], /^\/uploads\/crops\//);

        createdCropId = res.body.data.id;
    });

    test("Farmer crop upload rejects invalid crop_type", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, is_approved: true },
            body: {
                crop_name: "Invalid Crop",
                crop_type: "synthetic_chemical",
                quantity: "50",
                price: "100"
            }
        };
        const res = responseRecorder();

        await farmerController.uploadCrop(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /organic.*inorganic/i);
    });

    test("Farmer can list their own crops and fetch crop details", async () => {
        const req = { user: { id: farmerId, role: ROLES.FARMER, is_approved: true } };
        const res = responseRecorder();

        await farmerController.getMyCrops(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.ok(Array.isArray(res.body.data));
        const found = res.body.data.find((c) => c.id === createdCropId);
        assert.ok(found);
        assert.equal(found.farmer_id, farmerId);
    });

    // ----------------------------------------------------------------
    // 2. Buyer Browsing & Filtering
    // ----------------------------------------------------------------
    test("Buyer can view all available crops and filter by organic", async () => {
        const req = {
            user: { id: buyerId, role: ROLES.BUYER, is_approved: true },
            query: { crop_type: "organic" }
        };
        const res = responseRecorder();

        await buyerController.getAvailableCrops(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.ok(Array.isArray(res.body.data));
        const crop = res.body.data.find((c) => c.id === createdCropId);
        assert.ok(crop);
        assert.equal(crop.crop_type, "organic");
        assert.ok(crop.photos.length > 0);
        assert.equal(crop.farmer.id, farmerId);
        assert.equal(typeof crop.farmer.is_call_available, "boolean");
    });

    // ----------------------------------------------------------------
    // 3. Buyer Interest & Rating System
    // ----------------------------------------------------------------
    test("Buyer expresses interest in the crop with a 5-star rating", async () => {
        const req = {
            user: { id: buyerId, role: ROLES.BUYER, is_approved: true },
            params: { cropId: createdCropId },
            body: {
                rating: 5,
                notes: "Interested in purchasing 100 kg batch immediately for pharmaceutical extraction."
            }
        };
        const res = responseRecorder();

        await buyerController.expressInterest(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.interest.rating, 5);
        assert.equal(res.body.data.average_rating, 5);
        assert.equal(res.body.data.total_ratings, 1);
    });

    test("Buyer interest rejects invalid rating out of 1-5 range", async () => {
        const req = {
            user: { id: buyerId, role: ROLES.BUYER, is_approved: true },
            params: { cropId: createdCropId },
            body: { rating: 10 }
        };
        const res = responseRecorder();

        await buyerController.expressInterest(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /between 1 and 5/);
    });

    test("Farmer can view interested buyers and their interest ratings", async () => {
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, is_approved: true },
            query: { cropId: createdCropId }
        };
        const res = responseRecorder();

        await farmerController.getFarmerInterests(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.ok(Array.isArray(res.body.data));
        const interest = res.body.data.find((i) => i.crop_id === createdCropId);
        assert.ok(interest);
        assert.equal(interest.rating, 5);
        assert.equal(interest.buyer.id, buyerId);
        assert.equal(interest.buyer.full_name, mockBuyer.full_name);
    });

    // ----------------------------------------------------------------
    // 4. Call Availability Toggle (Farmer & Buyer)
    // ----------------------------------------------------------------
    test("Farmer can toggle call availability ON and OFF", async () => {
        const reqTurnOff = {
            user: { id: farmerId, role: ROLES.FARMER, is_approved: true },
            body: { is_call_available: false }
        };
        const resTurnOff = responseRecorder();
        await farmerController.setCallAvailability(reqTurnOff, resTurnOff);

        assert.equal(resTurnOff.statusCode, 200);
        assert.equal(resTurnOff.body.data.is_call_available, false);
        assert.equal(resTurnOff.body.data.status, "OFF");

        // Verify retrieval
        const reqGet = { user: { id: farmerId, role: ROLES.FARMER, is_approved: true } };
        const resGet = responseRecorder();
        await farmerController.getCallAvailability(reqGet, resGet);
        assert.equal(resGet.body.data.is_call_available, false);
    });

    test("Buyer can toggle call availability ON and OFF", async () => {
        const reqTurnOff = {
            user: { id: buyerId, role: ROLES.BUYER, is_approved: true },
            body: { status: "OFF" }
        };
        const resTurnOff = responseRecorder();
        await buyerController.setCallAvailability(reqTurnOff, resTurnOff);

        assert.equal(resTurnOff.statusCode, 200);
        assert.equal(resTurnOff.body.data.is_call_available, false);
        assert.equal(resTurnOff.body.data.status, "OFF");
    });

    // ----------------------------------------------------------------
    // 5. Calling Functionality & Permission Enforcement
    // ----------------------------------------------------------------

    // Scenario A: Buyer calls Farmer
    test("Buyer cannot call farmer when farmer's call availability is OFF", async () => {
        // Farmer availability is currently OFF
        await CallModel.setUserAvailability(farmerId, false);

        const req = {
            user: { id: buyerId, role: ROLES.BUYER, is_approved: true },
            body: { farmer_id: farmerId, crop_id: createdCropId }
        };
        const res = responseRecorder();

        await buyerController.callFarmer(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.call_permitted, false);
        assert.match(res.body.message, /not available to receive calls.*turned OFF/i);
    });

    test("Buyer can call farmer when farmer's call availability is ON", async () => {
        // Farmer turns availability ON
        await CallModel.setUserAvailability(farmerId, true);

        const req = {
            user: { id: buyerId, role: ROLES.BUYER, is_approved: true },
            body: { farmer_id: farmerId, crop_id: createdCropId }
        };
        const res = responseRecorder();

        await buyerController.callFarmer(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.call_permitted, true);
        assert.equal(res.body.data.receiver_id, farmerId);
        assert.equal(res.body.data.receiver_phone, mockFarmer.mobile_number);
        assert.equal(res.body.data.call_status, "permitted");
    });

    // Scenario B: Farmer calls Buyer
    test("Farmer cannot call buyer who has NOT expressed interest in their crops", async () => {
        // uninterestedBuyerId has not expressed interest
        const req = {
            user: { id: farmerId, role: ROLES.FARMER, is_approved: true },
            body: { buyer_id: uninterestedBuyerId, crop_id: createdCropId }
        };
        const res = responseRecorder();

        await farmerController.callBuyer(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.call_permitted, false);
        assert.match(res.body.message, /only call buyers who have expressed interest/i);
    });

    test("Farmer cannot call interested buyer when buyer's call availability is OFF", async () => {
        // Buyer has expressed interest, but buyer availability is OFF
        await CallModel.setUserAvailability(buyerId, false);

        const req = {
            user: { id: farmerId, role: ROLES.FARMER, is_approved: true },
            body: { buyer_id: buyerId, crop_id: createdCropId }
        };
        const res = responseRecorder();

        await farmerController.callBuyer(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.call_permitted, false);
        assert.match(res.body.message, /not available to receive calls.*turned OFF/i);
    });

    test("Farmer can call interested buyer when buyer's call availability is ON", async () => {
        // Buyer turns availability ON
        await CallModel.setUserAvailability(buyerId, true);

        const req = {
            user: { id: farmerId, role: ROLES.FARMER, is_approved: true },
            body: { buyer_id: buyerId, crop_id: createdCropId }
        };
        const res = responseRecorder();

        await farmerController.callBuyer(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.call_permitted, true);
        assert.equal(res.body.data.receiver_id, buyerId);
        assert.equal(res.body.data.receiver_phone, mockBuyer.mobile_number);
        assert.equal(res.body.data.call_status, "permitted");
    });
});
