import { PRIORITY_SEGMENTS, RECOMMENDED_SCENARIO } from "./recommendation.js";
import { loadSimulatorEngine } from "./simulator-engine.js";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const percent = (value) => `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value * 100)}%`;
const channelOrder = ["Gym & Office", "DTC Online", "Retail/Grocery"];

async function loadEvidence() {
  const response = await fetch("data/app_data/strategy_evidence.json");
  if (!response.ok) throw new Error("Prepared survey evidence unavailable");
  const data = await response.json();
  if (!Number.isInteger(data.respondentCount) || data.respondentCount <= 0) throw new Error("Invalid survey sample");
  return data;
}

function card(title, metrics, priority = false) {
  const article = document.createElement("article");
  article.className = `panel audience-card${priority ? " audience-priority" : ""}`;
  const heading = document.createElement("h3");
  heading.textContent = title;
  article.append(heading);
  if (priority) {
    const badge = document.createElement("p");
    badge.className = "eyebrow";
    badge.textContent = "Priority segment";
    article.append(badge);
  }
  const list = document.createElement("dl");
  for (const [name, value] of metrics) {
    const group = document.createElement("div");
    const label = document.createElement("dt");
    const detail = document.createElement("dd");
    label.textContent = name;
    detail.textContent = value;
    group.append(label, detail);
    list.append(group);
  }
  article.append(list);
  return article;
}

export async function initialiseStoryAudiences() {
  const get = (id) => document.getElementById(id);
  async function loadSegments() {
    get("segments-results").hidden = true;
    get("segment-comparison").replaceChildren();
    get("retry-segments").hidden = true;
    get("segments-status").textContent = "Loading segment evidence…";
    try {
      const evidence = await loadEvidence();
      const segments = evidence.segments;
      if (!Array.isArray(segments) || segments.length !== 4 || new Set(segments.map((segment) => segment.name)).size !== 4 ||
          !PRIORITY_SEGMENTS.every((name) => segments.some((segment) => segment.name === name)) ||
          segments.some((segment) => typeof segment.name !== "string" || !segment.name ||
            !Number.isInteger(segment.respondentCount) || segment.respondentCount <= 0 ||
            !Number.isInteger(segment.priceRespondentCount) || segment.priceRespondentCount <= 0 ||
            !Number.isFinite(segment.purchaseIntent) || segment.purchaseIntent < 0 || segment.purchaseIntent > 10 ||
            !Number.isFinite(segment.monthlySpendEur) || segment.monthlySpendEur < 0 ||
            !Number.isFinite(segment.tooExpensiveEur) || segment.tooExpensiveEur <= 0) ||
          segments.reduce((total, segment) => total + segment.respondentCount, 0) !== evidence.respondentCount) {
        throw new Error("Incomplete segment evidence");
      }
      const ordered = [...segments].sort((a, b) => b.respondentCount - a.respondentCount);
      get("segment-comparison").replaceChildren(...ordered.map((segment) => {
        const item = card(segment.name, [
          ["Survey size", `${segment.respondentCount} of ${evidence.respondentCount} · ${percent(segment.respondentCount / evidence.respondentCount)}`],
          ["Purchase intent", `${number.format(segment.purchaseIntent)} / 10`],
          ["Monthly beverage spend", money.format(segment.monthlySpendEur)],
          ["Mean “too expensive” threshold", money.format(segment.tooExpensiveEur)],
          ["Price-sensitivity sample", `n = ${segment.priceRespondentCount}`],
        ], PRIORITY_SEGMENTS.includes(segment.name));
        item.dataset.segment = segment.name;
        return item;
      }));
      const largest = ordered[0];
      const gap = largest.tooExpensiveEur - RECOMMENDED_SCENARIO.priceEur;
      const relationship = Math.abs(gap) < 1e-9 ? "equal to" : `${money.format(Math.abs(gap))} ${gap > 0 ? "above" : "below"}`;
      get("segments-price-context").textContent = `Compare with our recommended ${money.format(RECOMMENDED_SCENARIO.priceEur)} per can. Highlighted segments are our launch priorities.`;
      get("segments-insight").textContent = `${largest.name} is the largest segment (${largest.respondentCount} of ${evidence.respondentCount}), but its mean “too expensive” threshold is ${money.format(largest.tooExpensiveEur)} — ${relationship} our ${money.format(RECOMMENDED_SCENARIO.priceEur)} price. Size alone does not establish willingness to buy.`;
      get("segments-decision").textContent = `Prioritise ${PRIORITY_SEGMENTS.join(" and ")}. Their purchase intent and price headroom support the launch choice; the largest group is not automatically the strongest opportunity. A segment average cannot tell us which individual shoppers are reachable.`;
      get("segments-results").hidden = false;
      get("segments-status").textContent = "Segment evidence ready";
    } catch {
      get("segments-status").textContent = "Segment evidence unavailable. Could not load complete prepared aggregates. Retry loading.";
      get("retry-segments").hidden = false;
    }
  }

  async function loadChannels() {
    get("channels-results").hidden = true;
    get("channel-comparison").replaceChildren();
    get("retry-channels").hidden = true;
    get("channels-status").textContent = "Loading channel economics…";
    try {
      const [evidence, calculate] = await Promise.all([loadEvidence(), loadSimulatorEngine()]);
      if (!Array.isArray(evidence.channels) || evidence.channels.length !== 3 ||
          new Set(evidence.channels.map((channel) => channel.name)).size !== 3 ||
          evidence.channels.some((channel) => !channelOrder.includes(channel.name) ||
            !Number.isInteger(channel.respondentCount) || channel.respondentCount < 0) ||
          evidence.channels.reduce((total, channel) => total + channel.respondentCount, 0) !== evidence.respondentCount) {
        throw new Error("Incomplete channel preferences");
      }
      const result = calculate(RECOMMENDED_SCENARIO);
      const rows = channelOrder.map((name) => ({ name,
        count: evidence.channels.find((channel) => channel.name === name).respondentCount,
        contribution: result.economicsByChannel[name].contributionEur,
        allocation: RECOMMENDED_SCENARIO.channelMix[name],
      }));
      if (rows.some((row) => !Number.isFinite(row.contribution)) || !Number.isFinite(result.contributionPerUnitEur)) throw new Error("Invalid channel economics");
      get("channel-comparison").replaceChildren(...rows.map((row) => {
        const item = card(row.name, [
          ["Preferred survey channel", `${percent(row.count / evidence.respondentCount)} · ${row.count} of ${evidence.respondentCount}`],
          ["Contribution per can", money.format(row.contribution)],
          ["Our share of launch units", percent(row.allocation)],
        ]);
        item.dataset.channel = row.name;
        return item;
      }));
      const [gym, dtc, retail] = rows;
      get("channels-price-context").textContent = `At ${money.format(RECOMMENDED_SCENARIO.priceEur)} per can, our allocation produces ${money.format(result.contributionPerUnitEur)} blended contribution per unit.`;
      get("channels-insight").textContent = `Retail/Grocery is preferred by ${percent(retail.count / evidence.respondentCount)} of respondents, but returns ${money.format(retail.contribution)} per can versus ${money.format(gym.contribution)} in Gym & Office and ${money.format(dtc.contribution)} in DTC Online. Grocery earns ${percent(retail.contribution / gym.contribution)} and ${percent(retail.contribution / dtc.contribution)} of those contributions respectively — roughly half at this price.`;
      get("channels-decision").textContent = `Allocate ${rows.map((row) => `${percent(row.allocation)} to ${row.name}`).join(", ")}. We prioritise contribution over matching the largest survey channel, accepting less grocery shelf presence while keeping a ${percent(retail.allocation)} grocery foothold.`;
      get("channels-results").hidden = false;
      get("channels-status").textContent = "Channel comparison ready";
    } catch {
      get("channels-status").textContent = "Channel comparison unavailable. Could not load complete prepared preferences and economics. Retry loading.";
      get("retry-channels").hidden = false;
    }
  }
  get("retry-segments").onclick = loadSegments;
  get("retry-channels").onclick = loadChannels;
  await Promise.all([loadSegments(), loadChannels()]);
}
