import { loadSimulatorEngine } from "./simulator-engine.js";
import { RECOMMENDED_SCENARIO } from "./recommendation.js";
import { initialisePricePositioning } from "./price-positioning.js";

const TESTED_PRICES = [1.79, 2.19, 2.59];
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
const preciseMoney = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export function compareTestedPrices(calculate) {
  return TESTED_PRICES.map((priceEur) => {
    const result = calculate({ ...RECOMMENDED_SCENARIO, priceEur });
    if (result.acceptanceRangeStatus !== "observed" ||
        !Number.isFinite(result.acceptancePct) || result.acceptancePct < 0 || result.acceptancePct > 100 ||
        !Number.isFinite(result.contributionPerUnitEur) || !Number.isFinite(result.paybackMonths)) {
      throw new Error("Complete evidence for all three tested prices is required.");
    }
    return { ...result, acceptanceContributionEur: result.acceptancePct / 100 * result.contributionPerUnitEur };
  });
}

export async function initialiseStoryPrice() {
  const get = (id) => document.getElementById(id);
  const controls = get("price-choice-controls");
  const selectedPrice = () => Number(controls.querySelector("input:checked").value);
  const metric = (key) => document.querySelector(`[data-price-metric="${key}"]`);
  let comparisons;

  function update() {
    if (!comparisons) return;
    const selected = comparisons.find((row) => row.priceEur === selectedPrice());
    const [low, middle, high] = comparisons;
    const bestScore = Math.max(...comparisons.map((row) => row.acceptanceContributionEur));
    const winners = comparisons.filter((row) => Math.abs(row.acceptanceContributionEur - bestScore) < 1e-9);
    get("price-choice-title").textContent = `${money.format(selected.priceEur)} per can${selected.priceEur === RECOMMENDED_SCENARIO.priceEur ? " · our recommendation" : ""}`;
    metric("acceptance").textContent = `${number.format(selected.acceptancePct)}%`;
    metric("contribution").textContent = money.format(selected.contributionPerUnitEur);
    metric("product").textContent = preciseMoney.format(selected.acceptanceContributionEur);
    get("price-choice-formula").textContent = `${number.format(selected.acceptancePct)}% × contribution per can = ${preciseMoney.format(selected.acceptanceContributionEur)}. Product uses the unrounded contribution.`;
    const gain = selected === low
      ? `Estimated acceptance is ${number.format(low.acceptancePct)}%, compared with ${number.format(middle.acceptancePct)}% at ${money.format(middle.priceEur)}.`
      : selected === high
        ? `You keep ${money.format(high.contributionPerUnitEur)} per can, the highest contribution of the three.`
        : `You keep ${money.format(middle.contributionPerUnitEur)} per can while retaining ${number.format(middle.acceptancePct)}% estimated acceptance.`;
    const risk = selected === low
      ? `Each can earns ${money.format(middle.contributionPerUnitEur - low.contributionPerUnitEur)} less than at ${money.format(middle.priceEur)}.`
      : selected === high
        ? `Acceptance falls by ${number.format(middle.acceptancePct - high.acceptancePct)} percentage points versus ${money.format(middle.priceEur)}.`
        : `You give up ${number.format(low.acceptancePct - middle.acceptancePct)} percentage points of acceptance versus ${money.format(low.priceEur)}.`;
    get("price-choice-gain").textContent = gain;
    get("price-choice-risk").textContent = risk;
    const rows = comparisons.map((result) => {
      const row = document.createElement("tr");
      row.dataset.price = String(result.priceEur);
      row.classList.toggle("price-score-best", winners.includes(result));
      if (result === selected) row.setAttribute("aria-current", "true");
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = `${money.format(result.priceEur)}${winners.includes(result) ? " · highest product" : ""}`;
      row.append(label);
      for (const text of [`${number.format(result.acceptancePct)}%`, money.format(result.contributionPerUnitEur), preciseMoney.format(result.acceptanceContributionEur)]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      return row;
    });
    get("price-comparison-body").replaceChildren(...rows);
    get("price-choice-verdict").textContent = `${winners.map((row) => money.format(row.priceEur)).join(" and ")} ${winners.length > 1 ? "tie for the highest" : "has the highest"} acceptance × contribution among the three tested prices (${preciseMoney.format(bestScore)}).`;
    const acceptanceChange = high.acceptancePct < middle.acceptancePct ? "falls" : "moves";
    const explanation = high.acceptanceContributionEur < middle.acceptanceContributionEur
      ? "Higher earnings per can do not compensate in our acceptance × contribution comparison."
      : "The comparison score above combines acceptance with contribution to choose between the tested prices.";
    get("price-payback-explanation").textContent = `At ${money.format(high.priceEur)}, modelled payback is ${number.format(high.paybackMonths)} months versus ${number.format(middle.paybackMonths)} at ${money.format(middle.priceEur)}, assuming ${money.format(RECOMMENDED_SCENARIO.cacEur)} CAC. That is payback per acquired customer: it does not account for how many customers accept the price. Acceptance ${acceptanceChange} from ${number.format(middle.acceptancePct)}% to ${number.format(high.acceptancePct)}%. ${explanation} The simulator calculates acquired customers as budget / CAC; acceptance is separate and is not applied again to those customers.`;
  }

  async function load() {
    comparisons = undefined;
    controls.disabled = true;
    get("price-choice-results").hidden = true;
    get("retry-price-choice").hidden = true;
    get("price-choice-status").textContent = "Loading tested-price comparison…";
    document.querySelectorAll("[data-price-metric]").forEach((element) => { element.textContent = "—"; });
    get("price-comparison-body").replaceChildren();
    try {
      comparisons = compareTestedPrices(await loadSimulatorEngine());
      update();
      controls.disabled = false;
      get("price-choice-results").hidden = false;
      get("price-choice-status").textContent = "Tested-price comparison ready";
    } catch {
      comparisons = undefined;
      get("price-choice-status").textContent = "Price comparison unavailable. Could not load complete tested-price assumptions. Retry loading.";
      get("retry-price-choice").hidden = false;
    }
  }

  get("price-mix-note").textContent = `Fixed recommended mix: ${["Gym & Office", "DTC Online", "Retail/Grocery"].map((channel) => `${channel} ${number.format(RECOMMENDED_SCENARIO.channelMix[channel] * 100)}%`).join(" · ")}.`;
  controls.onchange = update;
  get("retry-price-choice").onclick = load;
  await Promise.all([load(), initialisePricePositioning({
    readPrice: selectedPrice, priceEventTarget: controls, priceEventName: "change", priceDescription: "selected tested price",
  })]);
}
