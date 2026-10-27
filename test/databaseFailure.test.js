const { test } = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/config/supabase");
const failure = { code: "42P01", message: "relation does not exist" };
const query = new Proxy(
  {},
  {
    get(target, key) {
      if (key === "then")
        return (resolve, reject) =>
          Promise.resolve({ data: null, error: failure }).then(resolve, reject);
      return () => query;
    },
  },
);
Object.assign(config, {
  isConfigured: true,
  supabaseAdmin: { from: () => query },
});
const { CropModel } = require("../src/models/cropModel");
const { InterestModel } = require("../src/models/interestModel");
const { CallModel } = require("../src/models/callModel");
test("configured database errors never fall back to local data or permit contact", async () => {
  for (const action of [
    () => CropModel.findById("id"),
    () => CropModel.findAllAvailable(),
    () =>
      CropModel.createCrop({
        crop_name: "Wheat",
        crop_type: "organic",
        quantity: 1,
        price: 2,
      }),
    () => InterestModel.findByCropId("id"),
    () => InterestModel.findByBuyerId("id"),
    () =>
      InterestModel.upsertInterest({
        crop_id: "id",
        buyer_id: "id",
        rating: 5,
      }),
    () => CallModel.getUserAvailability("id"),
    () => CallModel.setUserAvailability("id", false),
    () => CallModel.logCall({ status: "permitted" }),
    () => CallModel.listUserCalls(""),
  ])
    await assert.rejects(action, (error) => error === failure);
});
