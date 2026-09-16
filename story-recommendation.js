import { loadSimulatorEngine } from "./simulator-engine.js";
import { PRIORITY_SEGMENTS, RECOMMENDED_SCENARIO } from "./recommendation.js";
import { rankCities } from "./city-engine.js";
import { assessLaunch, validateLaunchData } from "./launch-window.js";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const oneDecimal = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const mixOrder = ["Gym & Office", "DTC Online", "Retail/Grocery"];
const mixText = () => mixOrder.map((channel) => `${channel} ${number.format(RECOMMENDED_SCENARIO.channelMix[channel] * 100)}%`).join(" · ");

async function loadPrepared(name) {
  const response = await fetch(`data/app_data/${name}.json`);
  if (!response.ok) throw new Error(`Unable to load ${name}`);
  return response.json();
}

export async function initialiseStoryRecommendation() {
  const get = (id) => document.getElementById(id);
  const retry = get("retry-recommendation");
  const scenario = RECOMMENDED_SCENARIO;
  get("strategy-channels").textContent = mixText();
  get("strategy-price").textContent = `${money.format(scenario.priceEur)} per 330ml can`;
  get("outcome-setting").textContent = `${money.format(scenario.priceEur)} · ${mixText()}`;

  async function load() {
    retry.hidden = true;
    get("recommendation-status").textContent = "Loading recommendation evidence…";
    get("outcome-status").textContent = "Loading the recommended scenario…";
    try {
      const [calculate, evidence, cityData, timing] = await Promise.all([
        loadSimulatorEngine(), loadPrepared("strategy_evidence"),
        loadPrepared("city_prioritisation"), loadPrepared("launch_window"),
      ]);
      const priorities = PRIORITY_SEGMENTS.map((name) => evidence.segments.find((segment) => segment.name === name));
      const berlin = cityData.cities.find((city) => city.city === "Berlin");
      const munich = cityData.cities.find((city) => city.city === "Munich");
      const april = timing.months.find((month) => month.month === 4);
      const may = timing.months.find((month) => month.month === 5);
      const result = calculate(scenario);
      const affordable = calculate({ ...scenario, priceEur: 1.79 });
      const values = [result.contributionPerUnitEur, result.ltvCacRatio, result.paybackMonths,
        result.acceptancePct, result.targetLtvCacRatio, affordable.paybackMonths, affordable.acceptancePct,
        ...priorities.flatMap((segment) => [segment?.respondentCount, segment?.purchaseIntent,
          segment?.priceSensitivity, segment?.tooExpensiveEur, segment?.priceRespondentCount]),
        evidence.respondentCount, evidence.groceryRespondentCount,
        berlin?.marketSizeEur, berlin?.growth, berlin?.wellnessRespondentCount, berlin?.respondentCount,
        munich?.marketSizeEur, munich?.growth, munich?.wellnessDensity, cityData.nationalMarketEur,
        april?.demandIndex, may?.demandIndex];
      if (values.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("Incomplete recommendation evidence");

      const share = (city) => number.format(city.marketSizeEur / cityData.nationalMarketEur * 100);
      const growth = berlin.growth === munich.growth
        ? `the same ${number.format(berlin.growth * 100)}% growth`
        : `${number.format(berlin.growth * 100)}% vs ${number.format(munich.growth * 100)}% growth`;
      get("strategy-where").textContent = `Berlin — ${share(berlin)}% assumed regional market share vs Munich’s ${share(munich)}%, ${growth}; wellness respondents ${berlin.wellnessRespondentCount}/${berlin.respondentCount} (${oneDecimal.format(berlin.wellnessRespondentCount / berlin.respondentCount * 100)}%) vs Munich’s ${oneDecimal.format(munich.wellnessDensity * 100)}%.`;
      get("strategy-who").textContent = priorities.map((segment) => `${segment.name} — ${segment.respondentCount} of ${evidence.respondentCount} respondents; intent ${number.format(segment.purchaseIntent)}/10; price sensitivity ${number.format(segment.priceSensitivity)}/10; mean “too expensive” threshold ${money.format(segment.tooExpensiveEur)}.`).join(" ");
      get("strategy-when").textContent = `April, before the seasonal climb — demand index ${number.format(april.demandIndex)}, rising to ${number.format(may.demandIndex)} in May (baseline ${number.format(timing.indexBaseline)}).`;
      const baseline = rankCities(cityData.cities);
      const wellnessLeader = [...baseline].sort((a, b) => b.wellnessDensity - a.wellnessDensity)[0];
      get("city-insight").textContent = `${get("strategy-where").textContent} At equal weights, ${baseline[0].city} leads with an index of ${oneDecimal.format(baseline[0].score)}/100. ${wellnessLeader.city} has the highest wellness share (${oneDecimal.format(wellnessLeader.wellnessDensity * 100)}%), so emphasising that criterion can change the leader. Regional shares and growth are illustrative assumptions; the wellness measure describes the synthetic survey sample.`;
      const aprilAssessment = assessLaunch(validateLaunchData(timing), 4);
      const septemberAssessment = assessLaunch(timing, 9);
      get("timing-insight").textContent = `April starts at demand index ${number.format(april.demandIndex)}, before May’s ${number.format(may.demandIndex)}. The first-three-month average is ${number.format(aprilAssessment.firstThreeAverage)} for April versus ${number.format(septemberAssessment.firstThreeAverage)} for September. The wait for a strong-demand test is ${aprilAssessment.wait} month for April versus ${septemberAssessment.wait} months for September, using the existing index-${number.format(timing.demandTestThreshold)} rule. These are seasonal comparisons, not sales forecasts.`;
      get("strategy-evidence-note").textContent = `Evidence: market context (Exhibit 1), customer survey (Exhibit 4), price-sensitivity survey (Exhibit 10) and seasonality (Exhibit 12). Price thresholds are means from separate samples: ${priorities.map((segment) => `${segment.name}, ${segment.priceRespondentCount} respondents`).join("; ")}. They are not guaranteed willingness to pay.`;

      const metrics = {
        contribution: money.format(result.contributionPerUnitEur),
        ratio: `${number.format(result.ltvCacRatio)}:1`,
        payback: `${number.format(result.paybackMonths)} months`,
        acceptance: `${number.format(result.acceptancePct)}%`,
      };
      Object.entries(metrics).forEach(([key, value]) => {
        document.querySelector(`[data-outcome-metric="${key}"]`).textContent = value;
      });
      get("outcome-target").textContent = `${result.ltvCacTargetMet ? "Meets" : "Below"} the ${number.format(result.targetLtvCacRatio)}:1 LTV:CAC target`;
      get("outcome-target").dataset.state = result.ltvCacTargetMet ? "pass" : "fail";
      get("outcome-assumptions").textContent = `Assumes ${money.format(scenario.cacEur)} CAC per acquired customer and a ${money.format(scenario.marketingBudgetEur)} marketing budget. Budget scales customer acquisition, not these per-customer returns.`;
      const channel = (name) => money.format(result.economicsByChannel[name].contributionEur);
      get("outcome-tradeoff").textContent = `We give up ${number.format(affordable.acceptancePct - result.acceptancePct)} percentage points of estimated acceptance versus €1.79 and limit grocery shelf presence, even though ${oneDecimal.format(evidence.groceryRespondentCount / evidence.respondentCount * 100)}% of respondents prefer Retail/Grocery. In exchange, at ${money.format(scenario.priceEur)} we keep ${channel("Gym & Office")} per unit in Gym & Office and ${channel("DTC Online")} in DTC, versus ${channel("Retail/Grocery")} in grocery. At the same mix and CAC, acquisition pays back in ${number.format(result.paybackMonths)} months instead of ${number.format(affordable.paybackMonths)} at €1.79. The ${number.format(scenario.channelMix["Retail/Grocery"] * 100)}% grocery allocation keeps a limited shelf presence.`;
      get("recommendation-status").textContent = "Recommendation evidence ready";
      get("outcome-status").textContent = "Recommended scenario ready";
    } catch {
      document.querySelectorAll("[data-outcome-metric]").forEach((metric) => { metric.textContent = "—"; });
      get("outcome-target").textContent = "";
      get("outcome-target").removeAttribute("data-state");
      get("outcome-assumptions").textContent = "";
      get("outcome-tradeoff").textContent = "Comparison unavailable until the prepared data loads.";
      get("strategy-where").textContent = "Berlin — supporting evidence unavailable.";
      get("strategy-who").textContent = `${PRIORITY_SEGMENTS.join(" and ")} — supporting evidence unavailable.`;
      get("strategy-when").textContent = "April, before the seasonal climb — supporting evidence unavailable.";
      get("strategy-evidence-note").textContent = "";
      get("city-insight").textContent = "Recommendation evidence unavailable. Retry loading in Strategy; city ranking has its own data status above.";
      get("timing-insight").textContent = "Recommendation evidence unavailable. Retry loading in Strategy; the monthly comparison has its own data status above.";
      get("recommendation-status").textContent = "Could not load complete prepared recommendation data. Retry loading.";
      get("outcome-status").textContent = "Outcome unavailable. Use Retry loading in Strategy.";
      retry.hidden = false;
    }
  }
  retry.onclick = load;
  await load();
}
