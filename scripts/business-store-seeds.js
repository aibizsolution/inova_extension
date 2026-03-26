const { CATEGORY_META, SOURCES } = require("./business-store-seed-utils");
const { ADVERTISING_AND_MARKETING_SEEDS } = require("./business-store-seeds-advertising-marketing");
const { COMMERCE_AND_REVENUE_SEEDS } = require("./business-store-seeds-commerce-revenue");
const { PEOPLE_AND_FINANCE_SEEDS } = require("./business-store-seeds-people-finance");
const { PRODUCT_AND_MANAGER_SEEDS } = require("./business-store-seeds-product-manager");

const PUBLIC_BUSINESS_PROMPT_SEEDS = [
  ...ADVERTISING_AND_MARKETING_SEEDS,
  ...COMMERCE_AND_REVENUE_SEEDS,
  ...PEOPLE_AND_FINANCE_SEEDS,
  ...PRODUCT_AND_MANAGER_SEEDS,
];

module.exports = {
  CATEGORY_META,
  PUBLIC_BUSINESS_PROMPT_SEEDS,
  SOURCES,
};
