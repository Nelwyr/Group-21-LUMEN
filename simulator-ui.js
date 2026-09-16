import { loadSimulatorEngine } from "./simulator-engine.js";
import { RECOMMENDED_SCENARIO } from "./recommendation.js";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always",
});

// An explicit decision heuristic, not a model of either stakeholder's preferences.
export function describeTradeoff(result, input, calculate) {
  const premium = input.priceEur >= 2.19;
  const payback = result.contributionPerUnitEur > 0
    ? `${number.format(result.paybackMonths)} months` : "no payback";
  const ratio = `${number.format(result.ltvCacRatio)}:1`;
  const returnTarget = `${number.format(result.targetLtvCacRatio)}:1`;
  if (premium) {
    const affordable = calculate({ ...input, priceEur: 1.79 });
    const loss = Math.max(0, affordable.acceptancePct - result.acceptancePct);
    const sacrifice = `giving up ${number.format(loss)} percentage points of estimated acceptance versus €1.79 at the same mix, budget and CAC`;
    if (result.ltvCacTargetMet) {
      return `This setting serves Jonas's premium-price positioning and supports Elena's return objective (${ratio}, ${payback} payback), while ${sacrifice}.`;
    }
    return `This setting serves Jonas's premium-price positioning, while ${sacrifice} and missing Elena's ${returnTarget} return target (${ratio}, ${payback} payback).`;
  }
  const premiumReference = calculate({ ...input, priceEur: 2.59 });
  const forgone = premiumReference.contributionPerUnitEur - result.contributionPerUnitEur;
  const sacrifice = `giving up Jonas's premium-price positioning and ${money.format(forgone)} in unit contribution versus €2.59 at the same mix, budget and CAC`;
  if (result.ltvCacTargetMet) {
    return `This setting serves Elena's return objective (${ratio}, ${payback} payback), while ${sacrifice} in pursuit of broader acceptance.`;
  }
  return `This setting serves neither Jonas's premium-price objective nor Elena's ${returnTarget} return target (${ratio}, ${payback}); it prioritises affordability, ${sacrifice}.`;
}

export async function initialiseSimulator() {
  const form = document.getElementById("scenario-form");
  const controls = document.getElementById("scenario-controls");
  const status = document.getElementById("simulator-status");
  const error = document.getElementById("scenario-error");
  const warning = document.getElementById("scenario-warning");
  const target = document.getElementById("target-status");
  const tradeoff = document.getElementById("scenario-tradeoff");
  const retry = document.getElementById("retry-simulator");
  const total = document.getElementById("mix-total");
  const inputs = [...form.querySelectorAll("input")];
  const setting = RECOMMENDED_SCENARIO;
  const recommendedValues = { price: setting.priceEur, budget: setting.marketingBudgetEur, cac: setting.cacEur,
    "mix-dtc": setting.channelMix["DTC Online"] * 100,
    "mix-retail": setting.channelMix["Retail/Grocery"] * 100,
    "mix-gym": setting.channelMix["Gym & Office"] * 100 };
  Object.entries(recommendedValues).forEach(([id, value]) => { document.getElementById(id).value = value; });
  document.getElementById("recommended-channel-values").textContent = ["Gym & Office", "DTC Online", "Retail/Grocery"]
    .map((channel) => `${number.format(setting.channelMix[channel] * 100)}% ${channel}`).join(" · ");
  let calculate;

  function clearResults(message) {
    document.querySelectorAll("[data-metric]").forEach((metric) => { metric.textContent = "—"; });
    target.textContent = "";
    target.removeAttribute("data-state");
    warning.hidden = true;
    tradeoff.textContent = message;
  }

  function update() {
    if (!calculate) return;
    error.hidden = true;
    inputs.forEach((input) => input.removeAttribute("aria-invalid"));
    const value = (id) => document.getElementById(id).valueAsNumber;
    const shares = [value("mix-dtc"), value("mix-retail"), value("mix-gym")];
    const sum = shares.reduce((a, b) => a + b, 0);
    total.textContent = `Total: ${Number.isFinite(sum) ? number.format(sum) : "—"}%. Shares must add up to 100%.`;
    try {
      const invalid = inputs.filter((input) => !input.validity.valid);
      if (invalid.length) {
        invalid.forEach((input) => input.setAttribute("aria-invalid", "true"));
        throw new Error("Complete every field with a valid number. Price, budget and CAC must be positive; channel shares must be between 0% and 100%.");
      }
      if (Math.abs(sum - 100) > 1e-7) {
        ["mix-dtc", "mix-retail", "mix-gym"].forEach((id) => document.getElementById(id).setAttribute("aria-invalid", "true"));
        throw new Error(`Channel shares total ${number.format(sum)}%. Adjust them to total 100%.`);
      }
      const input = {
        priceEur: value("price"), marketingBudgetEur: value("budget"), cacEur: value("cac"),
        channelMix: { "DTC Online": shares[0] / 100, "Retail/Grocery": shares[1] / 100, "Gym & Office": shares[2] / 100 },
      };
      const result = calculate(input);
      const gap = result.ltvCacRatio - result.targetLtvCacRatio;
      const values = {
        contribution: money.format(result.contributionPerUnitEur), cac: money.format(input.cacEur),
        ratio: `${number.format(result.ltvCacRatio)}:1`,
        payback: result.contributionPerUnitEur > 0 ? `${number.format(result.paybackMonths)} months` : "No payback",
        acceptance: `${number.format(result.acceptancePct)}%`,
        customers: number.format(result.customersAcquired), ltv: money.format(result.scenarioLtvEur),
        gap: `${signed.format(gap)}×`,
      };
      Object.entries(values).forEach(([key, text]) => {
        document.querySelector(`[data-metric="${key}"]`).textContent = text;
      });
      const returnTarget = `${number.format(result.targetLtvCacRatio)}:1`;
      document.getElementById("target-gap-label").textContent = `Gap to ${returnTarget} target`;
      document.querySelectorAll("[data-return-target]").forEach((element) => { element.textContent = returnTarget; });
      target.textContent = `${result.ltvCacTargetMet ? "Meets" : "Below"} the ${returnTarget} target`;
      target.dataset.state = result.ltvCacTargetMet ? "pass" : "fail";
      const warnings = [];
      if (result.acceptanceRangeStatus.startsWith("clamped")) {
        warnings.push("Price is outside the tested €1.79–€2.59 range. Acceptance is held at the nearest tested endpoint; it is not an extrapolated demand forecast.");
      }
      if (result.contributionPerUnitEur <= 0) {
        warnings.push("Contribution is non-positive: customer purchases cannot recover acquisition spend.");
      }
      warning.textContent = warnings.join(" ");
      warning.hidden = !warnings.length;
      tradeoff.textContent = describeTradeoff(result, input, calculate);
    } catch (cause) {
      error.textContent = cause.message;
      error.hidden = false;
      clearResults("Fix the inputs to assess who this scenario serves and what is being given up.");
    }
  }

  async function load() {
    controls.disabled = true;
    retry.hidden = true;
    error.hidden = true;
    status.textContent = "Loading simulator…";
    try {
      calculate = await loadSimulatorEngine();
      controls.disabled = false;
      status.textContent = "Simulator ready";
      update();
    } catch {
      status.textContent = "Simulator unavailable";
      error.textContent = "Could not load the prepared simulator assumptions. Check the local web server and retry.";
      error.hidden = false;
      retry.hidden = false;
      clearResults("Scenario assessment is unavailable until the data loads.");
    }
  }
  form.addEventListener("input", update);
  form.addEventListener("submit", (event) => { event.preventDefault(); update(); });
  retry.addEventListener("click", load);
  await load();
}
