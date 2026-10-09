export function resolveAsaasConfig(code: "services" | "materials", env: Record<string, string | undefined>) {
  const prefix = code === "services" ? "ASAAS_SERVICES" : "ASAAS_MATERIALS"
  const apiKey = String(env[`${prefix}_API_KEY`] || "").trim()
  const keyEnvironment = apiKey.startsWith("$aact_prod_") ? "production" : apiKey.startsWith("$aact_hmlg_") ? "sandbox" : undefined
  const configuredEnvironment = String(env[`${prefix}_ENVIRONMENT`] || env.ASAAS_ENVIRONMENT || "").trim().toLowerCase()
  const configuredBase = String(env[`${prefix}_BASE_URL`] || env.ASAAS_BASE_URL || "").trim().replace(/\/+$/, "")
  let configurationError = ""
  if (configuredEnvironment && !["sandbox", "production"].includes(configuredEnvironment)) {
    configurationError = `${prefix}_ENVIRONMENT ou ASAAS_ENVIRONMENT deve ser production ou sandbox.`
  }
  const urlEnvironment = configuredBase === "https://api.asaas.com/v3" ? "production" : configuredBase === "https://api-sandbox.asaas.com/v3" ? "sandbox" : undefined
  const environment: "production" | "sandbox" = configuredEnvironment === "production" || configuredEnvironment === "sandbox"
    ? configuredEnvironment : urlEnvironment || keyEnvironment || "sandbox"
  if ((keyEnvironment && keyEnvironment !== environment) || (urlEnvironment && urlEnvironment !== environment)) {
    configurationError = `A chave, o ambiente e a URL da conta ${code} nao correspondem. Confira ${prefix}_ENVIRONMENT, ASAAS_ENVIRONMENT e ASAAS_BASE_URL na Vercel.`
  }
  return {
    code,
    label: code === "services" ? "Servicos" : "Materiais",
    environment,
    baseUrl: configuredBase || (environment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3"),
    apiKey,
    webhookToken: String(env[`${prefix}_WEBHOOK_TOKEN`] || "").trim(),
    configurationError,
  }
}
