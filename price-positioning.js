const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
const percent = (value) => `${Math.round(value)}%`;
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

export function validatePositioningData(data) {
  const unique = (values) => new Set(values).size === values.length;
  if (!data || data.format !== "Single can (330ml)" || !Array.isArray(data.brands) || data.brands.length !== 4 ||
      !unique(data.brands) || data.brands.some((brand) => typeof brand !== "string" || !brand) ||
      !Array.isArray(data.channels) || data.channels.length !== 3 || !unique(data.channels) ||
      data.channels.some((channel) => typeof channel !== "string" || !channel) ||
      !Array.isArray(data.segments) || data.segments.length !== 4 || !unique(data.segments.map((segment) => segment.name)) ||
      data.segments.some((segment) => typeof segment.name !== "string" || !segment.name ||
        !Number.isInteger(segment.respondentCount) || segment.respondentCount <= 0 ||
        !Array.isArray(segment.awareness) || segment.awareness.length !== 4 ||
        !unique(segment.awareness.map((row) => row.brand)) || segment.awareness.some((row) =>
          !data.brands.includes(row.brand) || !Number.isInteger(row.awareCount) || row.awareCount < 0 ||
          row.awareCount > segment.respondentCount || !Number.isFinite(row.awarenessPct) ||
          Math.abs(row.awarenessPct - 100 * row.awareCount / segment.respondentCount) > 1e-7)) ||
      !Array.isArray(data.prices) || !data.prices.length ||
      !unique(data.prices.map((row) => JSON.stringify([row.brand, row.channel]))) ||
      data.prices.some((row) => !data.brands.includes(row.brand) || !data.channels.includes(row.channel) ||
        !Number.isFinite(row.priceEur) || row.priceEur <= 0)) {
    throw new Error("Incomplete price or segment awareness data");
  }
  return data;
}

export function positioningRows(data, segmentName, channel) {
  const segment = data.segments.find((item) => item.name === segmentName);
  if (!segment || !data.channels.includes(channel)) throw new Error("Select a segment and channel");
  return data.brands.map((brand, index) => ({
    ...segment.awareness.find((row) => row.brand === brand), index,
    respondentCount: segment.respondentCount,
    priceEur: data.prices.find((row) => row.brand === brand && row.channel === channel)?.priceEur ?? null,
  }));
}

function plot(rows, price, maxPrice, segment, width) {
  const left = 60, right = width - 40, top = 64, bottom = 354;
  const x = (value) => left + value / maxPrice * (right - left);
  const y = (value) => bottom - value / 100 * (bottom - top);
  const guides = [0, 25, 50, 75, 100].map((value) => `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="position-guide"/><text x="48" y="${y(value) + 4}" text-anchor="end">${value}%</text>`).join("");
  const intervals = width < 500 ? 3 : 7;
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => maxPrice / intervals * index).map((value) =>
    `<text x="${x(value)}" y="380" text-anchor="middle">${escape(money.format(value))}</text>`).join("");
  const dots = rows.filter((row) => row.priceEur !== null && row.respondentCount >= 8).map((row) =>
    `<g class="position-dot" data-brand="${escape(row.brand)}"><title>${escape(row.brand)}: ${money.format(row.priceEur)}, ${percent(row.awarenessPct)} awareness</title><circle cx="${x(row.priceEur)}" cy="${y(row.awarenessPct)}" r="13" class="position-brand-${row.index}"/><text x="${x(row.priceEur)}" y="${y(row.awarenessPct) + 4}" text-anchor="middle" class="position-dot-number">${row.index + 1}</text></g>`).join("");
  const line = price === null ? "" : `<line id="lumen-price-line" x1="${x(price)}" x2="${x(price)}" y1="${top}" y2="${bottom}"/><text x="${Math.max(145, Math.min(right - 70, x(price)))}" y="42" text-anchor="middle" class="position-lumen-label">LUMEN ${escape(money.format(price))}</text>`;
  return `<svg viewBox="0 0 ${width} 422" role="img" aria-labelledby="position-chart-title position-chart-desc"><title id="position-chart-title">Price and awareness among ${escape(segment)}</title><desc id="position-chart-desc">Competitor dots use this segment's survey awareness from 0 to 100 percent. The full-height LUMEN line indicates price only; LUMEN awareness is unmeasured. Numbered cards below give each competitor's values.</desc><text x="60" y="18">${width < 500 ? "Segment awareness (%)" : "Awareness within selected segment (%)"}</text>${guides}${ticks}${line}${dots}<text x="${width / 2}" y="411" text-anchor="middle">Single 330ml can · price (€)</text></svg>`;
}

function assessment(rows, price, segment) {
  if (price === null) return "Enter a valid positive retail price in the simulator to compare LUMEN. Competitor evidence remains visible; the LUMEN line is hidden until the price is valid.";
  const listed = rows.filter((row) => row.priceEur !== null);
  if (!listed.length) return "No comparable single-can prices are listed for this channel. Awareness remains available, but a price comparison cannot be made.";
  const closest = [...listed].sort((a, b) => Math.abs(price - a.priceEur) - Math.abs(price - b.priceEur) || a.index - b.index)[0];
  const difference = price - closest.priceEur;
  const relative = Math.abs(difference) < 1e-7 ? "matches" : `is ${money.format(Math.abs(difference))} ${difference > 0 ? "above" : "below"}`;
  const familiarity = closest.respondentCount < 8 ? "whose awareness is withheld for this small sample" : `known by ${percent(closest.awarenessPct)} of ${segment}`;
  return `At ${money.format(price)}, LUMEN ${relative} ${closest.brand} (${money.format(closest.priceEur)}), the nearest listed price, ${familiarity}. ${difference >= -1e-7 ? "Matching or exceeding that price means asking shoppers to choose a new entrant alongside an established brand." : "A lower price gives up shelf-price premium against this neighbour, while offering a price reason to try LUMEN."} Awareness measures familiarity; it does not establish quality, willingness to pay or LUMEN's own recognition.`;
}

export async function initialisePricePositioning({
  readPrice, priceEventTarget, priceEventName = "input", priceDescription = "live simulator price",
} = {}) {
  const controls = document.getElementById("position-controls");
  const segments = document.getElementById("position-segments");
  const channel = document.getElementById("position-channel");
  const status = document.getElementById("position-status");
  const results = document.getElementById("position-results");
  const retry = document.getElementById("retry-positioning");
  const priceInput = document.getElementById("price");
  const currentPrice = readPrice ?? (() => priceInput.validity.valid ? priceInput.valueAsNumber : null);
  let data;
  function update() {
    if (!data) return;
    const segment = segments.querySelector("input:checked").value;
    const rows = positioningRows(data, segment, channel.value);
    const value = currentPrice();
    const price = Number.isFinite(value) && value > 0 ? value : null;
    const maxPrice = Math.max(3.5, price ?? 0, ...data.prices.map((row) => row.priceEur));
    document.getElementById("position-audience").textContent = `${segment} · n = ${rows[0].respondentCount}`;
    document.getElementById("position-price-summary").textContent = price === null ? "LUMEN price invalid — line hidden" : `LUMEN ${money.format(price)} · ${priceDescription} · awareness unmeasured`;
    document.getElementById("position-assessment").textContent = assessment(rows, price, segment);
    const chart = document.getElementById("position-chart");
    chart.innerHTML = plot(rows, price, maxPrice, segment, Math.min(820, Math.max(240, chart.clientWidth || 820)));
    document.getElementById("position-brand-cards").innerHTML = rows.map((row) => {
      const missing = row.priceEur === null;
      const delta = price === null || missing ? null : price - row.priceEur;
      const gap = delta === null ? "Price gap unavailable" : Math.abs(delta) < 1e-7 ? "LUMEN matches this price" : `LUMEN ${money.format(Math.abs(delta))} ${delta > 0 ? "above" : "below"}`;
      return `<article class="position-brand-card"><h4><span class="position-brand-badge position-brand-${row.index}">${row.index + 1}</span>${escape(row.brand)}</h4><p class="position-awareness">${row.respondentCount < 8 ? "Awareness withheld" : `${percent(row.awarenessPct)} awareness`}</p><p>${row.respondentCount < 8 ? "Insufficient sample (n < 8)" : `${row.awareCount} of ${row.respondentCount} respondents${row.respondentCount < 15 ? " · directional small sample" : ""}`}</p><p>${missing ? "No single-can price listed in this channel; not plotted." : `${money.format(row.priceEur)} / single can`}</p><p>${gap}</p></article>`;
    }).join("");
    const missing = rows.filter((row) => row.priceEur === null).map((row) => row.brand);
    document.getElementById("position-channel-note").textContent = `${channel.value} · single 330ml cans only. ${missing.length ? `No comparable listing for ${missing.join(" and ")}; absence in this dataset does not prove the brand is unavailable.` : "All four brands have comparable listings."} Awareness covers the whole selected segment, not just shoppers in this channel.`;
  }
  async function load() {
    const previousSegment = segments.querySelector("input:checked")?.value;
    const previousChannel = channel.value;
    data = undefined;
    controls.disabled = true;
    results.hidden = true;
    retry.hidden = true;
    status.textContent = "Loading price positioning…";
    try {
      const response = await fetch("data/app_data/price_positioning.json");
      if (!response.ok) throw new Error("Prepared price data unavailable");
      data = validatePositioningData(await response.json());
      segments.innerHTML = data.segments.map((segment, index) => `<label class="position-segment"><input type="radio" name="position-segment" value="${escape(segment.name)}" ${segment.name === (previousSegment ?? data.segments[0].name) ? "checked" : ""}><span><strong>${escape(segment.name)}</strong><small>n = ${segment.respondentCount} · segment ${index + 1} of 4</small></span></label>`).join("");
      channel.innerHTML = data.channels.map((name) => `<option ${name === (previousChannel || "Retail/Grocery") ? "selected" : ""}>${escape(name)}</option>`).join("");
      controls.disabled = false;
      results.hidden = false;
      update();
      status.textContent = "Price positioning ready";
    } catch {
      data = undefined;
      controls.disabled = true;
      results.hidden = true;
      status.textContent = "Price positioning unavailable. Could not load complete prepared prices and segment awareness. Retry loading.";
      retry.hidden = false;
    }
  }
  segments.addEventListener("change", update);
  channel.addEventListener("change", update);
  (priceEventTarget ?? document.getElementById("scenario-form")).addEventListener(priceEventName, update);
  window.addEventListener("resize", update);
  window.addEventListener("hashchange", update);
  retry.addEventListener("click", load);
  await load();
}
