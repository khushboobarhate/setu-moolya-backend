const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const { changePassword } = require('../controllers/accountController');
const { authenticate, authorize, requirePasswordChanged } = require('../middlewares/authMiddleware');
const { loginLimit, passwordLimit } = require('../middlewares/rateLimits');
const { ROLES } = require('../models/userModel');
const accountAuth = [authenticate, authorize(ROLES.ADMIN)];
router.post('/login', loginLimit, admin.adminLogin);
router.get('/profile', accountAuth, admin.getAdminProfile);
router.post('/change-password', accountAuth, passwordLimit, changePassword);
// Route/body/query role values never grant this privilege. The database profile
// and verified Supabase identity are checked before every administrative action.
router.use(accountAuth, requirePasswordChanged);
router.get('/requests', admin.getDashboard);
router.get('/dashboard', admin.getDashboard);
router.get('/requests/:requestId', admin.getRequestDetail);
router.patch('/requests/:requestId', admin.updateRequestEmail);
router.post('/requests/:requestId/approve', admin.approveRequest);
router.post('/requests/:requestId/reject', admin.rejectRequest);
router.post('/requests/:requestId/send-credentials', admin.sendCredentials);
router.get('/users', admin.listApprovedUsers);
router.get('/crops', admin.listAllCrops);
router.get('/call-logs', admin.listAllCallLogs);
module.exports = router;
