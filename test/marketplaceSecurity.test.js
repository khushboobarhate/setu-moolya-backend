const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const farmer = require("../src/controllers/farmerController");
const buyer = require("../src/controllers/buyerController");
const { UserModel } = require("../src/models/userModel");
const { CropModel } = require("../src/models/cropModel");
const { InterestModel } = require("../src/models/interestModel");
const { CallModel } = require("../src/models/callModel");
const res = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
afterEach(() => mock.restoreAll());
test("crop numeric/type/length validation rejects partial values, infinity and wrong JSON types before persistence", async () => {
  let writes = 0;
  mock.method(CropModel, "createCrop", async () => {
    writes++;
    return {};
  });
  const valid = {
    crop_name: "Test wheat",
    crop_type: "organic",
    quantity: "12.5",
    price: "32.50",
    quantity_unit: "kg",
  };
  for (const changes of [
    { quantity: "12kg" },
    { quantity: "Infinity" },
    { quantity: [] },
    { quantity: 0 },
    { quantity: "1.0001" },
    { price: "32abc" },
    { price: "1.234" },
    { price: {} },
    { price: -1 },
    { crop_name: {} },
    { crop_name: "a" },
    { crop_type: [] },
    { quantity_unit: "unknown" },
    { description: {} },
    { photos: ["https://tracker.example/image.jpg"] },
  ]) {
    const response = res();
    await farmer.uploadCrop(
      { user: { id: randomUUID() }, body: { ...valid, ...changes } },
      response,
    );
    assert.equal(response.statusCode, 400, JSON.stringify(changes));
  }
  assert.equal(writes, 0);
});
test("availability accepts explicit booleans/ON-OFF and rejects ambiguous input", async () => {
  mock.method(CallModel, "setUserAvailability", async (id, value) => value);
  for (const body of [
    { is_call_available: "false" },
    { is_call_available: {} },
    { status: "anything" },
    { status: 1 },
    {},
  ]) {
    const response = res();
    await farmer.setCallAvailability(
      { user: { id: randomUUID() }, body },
      response,
    );
    assert.equal(response.statusCode, 400);
  }
  const response = res();
  await buyer.setCallAvailability(
    { user: { id: randomUUID() }, body: { is_call_available: false } },
    response,
  );
  assert.equal(response.body.data.is_call_available, false);
});
test("non-integer ratings, malformed IDs and non-text notes never write interests", async () => {
  let writes = 0;
  mock.method(InterestModel, "upsertInterest", async () => {
    writes++;
  });
  for (const body of [
    { rating: 1.5 },
    { rating: "5junk" },
    { rating: [5] },
    { rating: 5, notes: {} },
    { rating: 5, notes: "a".repeat(2001) },
  ]) {
    const response = res();
    await buyer.expressInterest(
      { params: { cropId: randomUUID() }, user: { id: randomUUID() }, body },
      response,
    );
    assert.equal(response.statusCode, 400);
  }
  const response = res();
  await buyer.expressInterest(
    {
      params: { cropId: "invalid" },
      user: { id: randomUUID() },
      body: { rating: 5 },
    },
    response,
  );
  assert.equal(response.statusCode, 400);
  assert.equal(writes, 0);
});
test("buyer cannot view or rate sold crops, and a call cannot attach another farmers crop", async () => {
  const cropId = randomUUID(),
    farmerId = randomUUID();
  mock.method(CropModel, "findById", async () => ({
    id: cropId,
    status: "sold",
    farmer_id: farmerId,
  }));
  for (const fn of [buyer.getCropDetail, buyer.expressInterest]) {
    const response = res();
    await fn(
      { params: { cropId }, body: { rating: 5 }, user: { id: randomUUID() } },
      response,
    );
    assert.equal(response.statusCode, 404);
  }
  const response = res();
  await buyer.callFarmer(
    {
      body: { crop_id: cropId, farmer_id: randomUUID() },
      user: { id: randomUUID() },
    },
    response,
  );
  assert.equal(response.statusCode, 404);
});
test("an unapproved receiver never has contact details revealed", async () => {
  mock.method(UserModel, "findById", async (id) => ({
    id,
    role: "farmer",
    is_approved: false,
    mobile_number: "9876543210",
  }));
  const response = res();
  await buyer.callFarmer(
    { body: { farmer_id: randomUUID() }, user: { id: randomUUID() } },
    response,
  );
  assert.equal(response.statusCode, 404);
  assert.ok(!JSON.stringify(response.body).includes("9876543210"));
});
test("interest summaries do not reveal a buyers email or phone before contact permission", async () => {
  const id = randomUUID(),
    crop = randomUUID();
  mock.method(UserModel, "findById", async () => ({
    id,
    full_name: "Sample buyer",
    role: "buyer",
    is_approved: true,
    email: "private@example.com",
    mobile_number: "9876543210",
  }));
  await InterestModel.upsertInterest({
    crop_id: crop,
    buyer_id: id,
    rating: 5,
  });
  await CallModel.setUserAvailability(id, false);
  const rows = await InterestModel.findByCropId(crop);
  assert.equal(rows[0].buyer.is_call_available, false);
  assert.equal(rows[0].buyer.mobile_number, undefined);
  assert.equal(rows[0].buyer.email, undefined);
});
test("internal database errors are not returned to the browser", async () => {
  mock.method(CropModel, "findByFarmerId", async () => {
    throw new Error("secret database detail");
  });
  const response = res();
  await farmer.getMyCrops({ user: { id: randomUUID() } }, response);
  assert.equal(response.statusCode, 500);
  assert.ok(!JSON.stringify(response.body).includes("secret database detail"));
});
