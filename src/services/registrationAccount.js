const { supabaseAdmin } = require("../config/supabase");
const { UserModel } = require("../models/userModel");
// GoTrue can insert auth.users before setting app_metadata. The trigger creates
// an unapproved profile, so synchronize its request link after createUser returns.
// Never adopt another account simply because its email matches an application.
const verifyRegistrationAccount = async (profile, request) => {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(
    profile.id,
  );
  const user = data?.user;
  if (
    error ||
    !user ||
    user.email?.toLowerCase() !== request.email ||
    user.app_metadata?.registration_request_id !== request.id ||
    user.app_metadata?.role !== request.role ||
    (profile.registration_request_id &&
      profile.registration_request_id !== request.id)
  ) {
    throw new Error(
      "Existing Auth account does not belong to this registration request.",
    );
  }
  return user;
};
const findRegistrationAccount = async (request) => {
  const profile =
    (await UserModel.findByRegistrationRequestId(request.id)) ||
    (await UserModel.findByEmail(request.email));
  if (profile) await verifyRegistrationAccount(profile, request);
  return profile;
};
const linkPendingProfile = async (userId, request) => {
  const profile = await UserModel.findById(userId);
  if (!profile || profile.is_approved)
    throw new Error("An unapproved platform profile is required.");
  await verifyRegistrationAccount(profile, request);
  if (
    profile.registration_request_id === request.id &&
    profile.role === request.role
  )
    return profile;
  return UserModel.linkPendingProfile(userId, request);
};
module.exports = {
  verifyRegistrationAccount,
  findRegistrationAccount,
  linkPendingProfile,
};
