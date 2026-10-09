import assert from "node:assert/strict"
import test from "node:test"
import { resolveAsaasConfig } from "./asaas-config.ts"

test("uses production for a production key when no environment is configured", () => {
  const config = resolveAsaasConfig("services", { ASAAS_SERVICES_API_KEY: "$aact_prod_example" })
  assert.equal(config.baseUrl, "https://api.asaas.com/v3")
  assert.equal(config.configurationError, "")
})
test("resolves each account independently", () => {
  const env = { ASAAS_SERVICES_API_KEY: "$aact_prod_services", ASAAS_MATERIALS_API_KEY: "$aact_hmlg_materials" }
  assert.equal(resolveAsaasConfig("services", env).environment, "production")
  assert.equal(resolveAsaasConfig("materials", env).environment, "sandbox")
  assert.equal(resolveAsaasConfig("materials", env).apiKey, env.ASAAS_MATERIALS_API_KEY)
})
test("does not silently override an explicit sandbox with a production key", () => {
  assert.ok(resolveAsaasConfig("services", { ASAAS_ENVIRONMENT: "sandbox", ASAAS_SERVICES_API_KEY: "$aact_prod_example" }).configurationError)
})
test("normalizes environment and detects URL conflicts", () => {
  assert.equal(resolveAsaasConfig("services", { ASAAS_ENVIRONMENT: " Production " }).environment, "production")
  assert.ok(resolveAsaasConfig("services", { ASAAS_ENVIRONMENT: "production", ASAAS_BASE_URL: "https://api-sandbox.asaas.com/v3" }).configurationError)
  assert.ok(resolveAsaasConfig("services", { ASAAS_ENVIRONMENT: "typo" }).configurationError)
})
test("account configuration overrides shared settings and legacy keys keep sandbox default", () => {
  assert.equal(resolveAsaasConfig("services", { ASAAS_ENVIRONMENT: "sandbox", ASAAS_SERVICES_ENVIRONMENT: "production" }).environment, "production")
  assert.equal(resolveAsaasConfig("services", { ASAAS_SERVICES_API_KEY: "legacy" }).environment, "sandbox")
})
