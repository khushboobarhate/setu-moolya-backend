const { isUuid } = require('../utils/validation');
const { UserModel, ROLES } = require('../models/userModel');
const { CropModel } = require('../models/cropModel');
const { CallModel } = require('../models/callModel');
const { CallRequestModel } = require('../models/callRequestModel');

/**
 * Controller: Buyer-Farmer Call Request and Approval System
 */

// ================================================================
// BUYER ACTIONS
// ================================================================

/**
 * @route   POST /api/buyer/calls/request
 * @desc    Buyer sends a call request to a farmer.
 *          Farmer phone is NEVER revealed before explicit farmer approval.
 * @access  Protected (Buyer)
 */
const buyerCreateCallRequest = async (req, res) => {
    try {
        const { farmer_id, crop_id, buyer_note } = req.body || {};

        if ((farmer_id && !isUuid(farmer_id)) || (crop_id && !isUuid(crop_id))) {
            return res.status(400).json({
                success: false,
                message: 'Valid UUIDs are required for farmer_id and optional crop_id.'
            });
        }

        let targetFarmerId = farmer_id;

        // Resolve farmer from crop if farmer_id not directly provided
        if (!targetFarmerId && crop_id) {
            const crop = await CropModel.findById(crop_id);
            if (!crop || crop.status !== 'available') {
                return res.status(404).json({
                    success: false,
                    message: 'Crop listing not found or is no longer available.'
                });
            }
            targetFarmerId = crop.farmer_id;
        }

        if (!targetFarmerId) {
            return res.status(400).json({
                success: false,
                message: 'farmer_id or a valid crop_id is required to request a call.'
            });
        }

        // Validate target farmer
        const farmer = await UserModel.findById(targetFarmerId);
        if (!farmer || farmer.role !== ROLES.FARMER || !farmer.is_approved) {
            return res.status(404).json({
                success: false,
                message: 'Farmer profile not found or is not approved.'
            });
        }

        // Check farmer call availability
        const isFarmerAvailable = await CallModel.getUserAvailability(targetFarmerId);
        if (!isFarmerAvailable) {
            return res.status(403).json({
                success: false,
                call_permitted: false,
                message: 'Farmer is currently not accepting calls or requests. Call availability is turned OFF.',
                data: {
                    farmer_id: targetFarmerId,
                    farmer_name: farmer.full_name,
                    is_call_available: false
                }
            });
        }

        // Prevent duplicate pending requests
        const existing = await CallRequestModel.findActiveBetween(req.user.id, targetFarmerId, crop_id);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'You already have a pending call request for this farmer.',
                data: existing
            });
        }

        // Create pending request
        const request = await CallRequestModel.createRequest({
            buyer_id: req.user.id,
            farmer_id: targetFarmerId,
            crop_id: crop_id || null,
            buyer_note: buyer_note ? String(buyer_note).slice(0, 300) : null
        });

        return res.status(201).json({
            success: true,
            message: 'Call request sent to farmer. You will be able to view their contact once approved.',
            data: request
        });
    } catch (error) {
        console.error('Buyer create call request error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to create call request.'
        });
    }
};

/**
 * @route   GET /api/buyer/calls/requests
 * @desc    Buyer lists their submitted call requests with status
 * @access  Protected (Buyer)
 */
const buyerListCallRequests = async (req, res) => {
    try {
        const { status } = req.query || {};
        const requests = await CallRequestModel.listForBuyer(req.user.id, { status });

        return res.status(200).json({
            success: true,
            data: requests
        });
    } catch (error) {
        console.error('Buyer list call requests error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch buyer call requests.'
        });
    }
};

/**
 * @route   GET /api/buyer/calls/requests/:id
 * @desc    Buyer retrieves a single call request.
 *          Reveals phone ONLY if status is approved.
 * @access  Protected (Buyer)
 */
const buyerGetCallRequestDetail = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isUuid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid request ID format.' });
        }

        const request = await CallRequestModel.findById(id);
        if (!request || request.buyer_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Call request not found.' });
        }

        const farmer = await UserModel.findById(request.farmer_id);
        const crop = request.crop_id ? await CropModel.findById(request.crop_id) : null;

        const responseData = {
            ...request,
            farmer: farmer
                ? {
                      id: farmer.id,
                      full_name: farmer.full_name,
                      city: farmer.city,
                      state: farmer.state,
                      photo_url: farmer.photo_url,
                      // Contact revealed ONLY after approval!
                      ...(request.status === 'approved' ? { phone: farmer.mobile_number || farmer.phone } : {})
                  }
                : null,
            crop: crop
                ? {
                      id: crop.id,
                      crop_name: crop.crop_name,
                      crop_type: crop.crop_type,
                      price: crop.price,
                      quantity: crop.quantity,
                      photos: crop.photos || []
                  }
                : null
        };

        return res.status(200).json({
            success: true,
            data: responseData
        });
    } catch (error) {
        console.error('Buyer get call request error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch call request details.'
        });
    }
};

// ================================================================
// FARMER ACTIONS
// ================================================================

/**
 * @route   GET /api/farmer/calls/requests
 * @desc    Farmer lists incoming call requests with pending count badge
 * @access  Protected (Farmer)
 */
const farmerListCallRequests = async (req, res) => {
    try {
        const { status } = req.query || {};
        const [requests, pendingCount] = await Promise.all([
            CallRequestModel.listForFarmer(req.user.id, { status }),
            CallRequestModel.getPendingCount(req.user.id)
        ]);

        return res.status(200).json({
            success: true,
            data: {
                requests,
                pendingCount
            }
        });
    } catch (error) {
        console.error('Farmer list call requests error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch incoming call requests.'
        });
    }
};

/**
 * @route   POST /api/farmer/calls/requests/:id/approve
 * @desc    Farmer approves a pending call request.
 *          Reveals farmer contact info to the requesting buyer only.
 * @access  Protected (Farmer)
 */
const farmerApproveCallRequest = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isUuid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid request ID format.' });
        }

        const existing = await CallRequestModel.findById(id);
        if (!existing || existing.farmer_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Call request not found.' });
        }

        if (existing.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `This call request has already been ${existing.status}.`
            });
        }

        const updated = await CallRequestModel.updateStatus(id, req.user.id, 'approved');

        // Log permitted call in call_logs table
        const farmerPhone = req.user.mobile_number || req.user.phone || req.user.profile?.mobile_number;
        await CallModel.logCall({
            caller_id: existing.buyer_id,
            receiver_id: req.user.id,
            crop_id: existing.crop_id || null,
            caller_role: ROLES.BUYER,
            receiver_role: ROLES.FARMER,
            status: 'permitted',
            phone_revealed: farmerPhone || null
        }).catch((err) => console.warn('Logging approved call log non-fatal:', err.message));

        return res.status(200).json({
            success: true,
            message: 'Call request approved. Your contact number is now visible to the buyer.',
            data: updated
        });
    } catch (error) {
        console.error('Farmer approve call request error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to approve call request.'
        });
    }
};

/**
 * @route   POST /api/farmer/calls/requests/:id/reject
 * @desc    Farmer rejects a pending call request.
 *          Farmer contact details remain strictly hidden.
 * @access  Protected (Farmer)
 */
const farmerRejectCallRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { rejection_reason } = req.body || {};

        if (!isUuid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid request ID format.' });
        }

        const existing = await CallRequestModel.findById(id);
        if (!existing || existing.farmer_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Call request not found.' });
        }

        if (existing.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `This call request has already been ${existing.status}.`
            });
        }

        const reason = rejection_reason ? String(rejection_reason).slice(0, 200) : null;
        const updated = await CallRequestModel.updateStatus(id, req.user.id, 'rejected', {
            rejection_reason: reason
        });

        // Log call rejection in call_logs table
        await CallModel.logCall({
            caller_id: existing.buyer_id,
            receiver_id: req.user.id,
            crop_id: existing.crop_id || null,
            caller_role: ROLES.BUYER,
            receiver_role: ROLES.FARMER,
            status: 'blocked_receiver_unavailable',
            phone_revealed: null
        }).catch((err) => console.warn('Logging rejected call log non-fatal:', err.message));

        return res.status(200).json({
            success: true,
            message: 'Call request rejected. Your contact information remains private.',
            data: updated
        });
    } catch (error) {
        console.error('Farmer reject call request error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to reject call request.'
        });
    }
};

module.exports = {
    buyerCreateCallRequest,
    buyerListCallRequests,
    buyerGetCallRequestDetail,
    farmerListCallRequests,
    farmerApproveCallRequest,
    farmerRejectCallRequest
};
