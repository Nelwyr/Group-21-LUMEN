export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export function validateLaunchData(data) {
  if (!data || !Array.isArray(data.months) || data.months.length !== 12 ||
      !Number.isFinite(data.indexBaseline) || data.indexBaseline <= 0 ||
      !Number.isFinite(data.demandTestThreshold) || data.demandTestThreshold <= data.indexBaseline ||
      data.months.some((row, index) => row.month !== index + 1 ||
        !Number.isFinite(row.demandIndex) || row.demandIndex <= 0 || !Number.isFinite(row.temperatureC)) ||
      !data.months.some((row) => row.demandIndex >= data.demandTestThreshold)) {
    throw new Error("Incomplete monthly seasonality data");
  }
  return data;
}

export function assessLaunch(data, month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Choose a valid launch month");
  const start = month - 1;
  const wait = Array.from({ length: 12 }, (_, offset) => offset)
    .find((offset) => data.months[(start + offset) % 12].demandIndex >= data.demandTestThreshold);
  const firstThree = Array.from({ length: 3 }, (_, offset) => data.months[(start + offset) % 12]);
  return {
    selected: data.months[start], wait,
    testMonth: MONTHS[(start + wait) % 12], nextYear: start + wait >= 12,
    firstThreeAverage: firstThree.reduce((sum, row) => sum + row.demandIndex, 0) / 3,
    firstThreeEnd: MONTHS[(start + 2) % 12],
  };
}

function tradeoff(result) {
  const month = MONTHS[result.selected.month - 1];
  if (result.wait === 0) {
    return `${month} starts inside the strong-demand window, so the first real demand test begins immediately. The cost: little quiet-market rehearsal before customers arrive; availability and execution must be ready at launch. Strong seasonal sales alone do not prove year-round demand.`;
  }
  const wait = `${result.wait} ${result.wait === 1 ? "month" : "months"}`;
  const testMonth = `${result.testMonth}${result.nextYear ? " next year" : ""}`;
  if (result.selected.month === 4) {
    return `April puts the product on shelf before the climb, with ${wait} to learn before the strong-demand window in ${testMonth}. The cost: commit inventory, distribution and launch spend early, with little time to fix the offer before demand accelerates.`;
  }
  if (result.selected.month === 9) {
    return `September offers a quieter market after the summer peak: learn cheaply with a deliberately small pilot. The cost is ${wait} of waiting, until ${testMonth}, for the first real demand test. Quiet-season results may understate summer potential; stock, team time and cash must bridge the gap.`;
  }
  return `${month} gives ${wait} to learn before ${testMonth}. A small pilot can limit spend while the team adjusts the offer. The cost: cash, stock and team time are committed before a strong-demand test, and quieter trading may understate summer potential.`;
}

function chart(data, chosen) {
  const width = 840, left = 46, step = 64, bottom = 218;
  const ceiling = Math.ceil(Math.max(...data.months.map((row) => row.demandIndex), data.indexBaseline) / 50) * 50;
  const y = (value) => bottom - value / ceiling * 160;
  const guides = [0, data.indexBaseline, ceiling].map((value) =>
    `<line x1="${left}" x2="820" y1="${y(value)}" y2="${y(value)}" class="${value === data.indexBaseline ? "launch-baseline" : "launch-guide"}"/><text x="36" y="${y(value) + 4}" text-anchor="end">${value}</text>`).join("");
  const bars = data.months.map((row, index) => {
    const x = left + step * index + step / 2;
    const selected = row.month === chosen;
    return `<g class="${selected ? "launch-selected" : "launch-month"}">
      ${selected ? `<rect x="${x - 28}" y="12" width="56" height="320" rx="7" class="launch-selection"/><text x="${x}" y="31" text-anchor="middle" class="launch-marker">Launch</text>` : ""}
      <rect x="${x - 17}" y="${y(row.demandIndex)}" width="34" height="${bottom - y(row.demandIndex)}" rx="3" class="launch-bar"/>
      <text x="${x}" y="${y(row.demandIndex) - 8}" text-anchor="middle" class="launch-value">${number.format(row.demandIndex)}</text>
      <text x="${x}" y="242" text-anchor="middle">${MONTHS[index].slice(0, 3)}</text>
      <text x="${x}" y="316" text-anchor="middle" class="launch-temperature">${number.format(row.temperatureC)}°</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} 342" role="img" aria-labelledby="launch-chart-title launch-chart-desc">
    <title id="launch-chart-title">Monthly demand index; ${MONTHS[chosen - 1]} launch highlighted</title>
    <desc id="launch-chart-desc">Bars show demand on one index axis, with a dashed line at the source baseline of ${data.indexBaseline}. Temperature is labelled separately below in degrees Celsius. Exact monthly values are available in the data table.</desc>
    ${guides}${bars}<text x="46" y="280">Average German temperature · °C</text>
  </svg>`;
}

export async function initialiseLaunchWindow() {
  const select = document.getElementById("launch-month");
  const controls = document.getElementById("launch-controls");
  const status = document.getElementById("launch-status");
  const results = document.getElementById("launch-results");
  const retry = document.getElementById("retry-launch");
  let data;
  function update() {
    if (!data) return;
    const month = Number(select.value);
    const result = assessLaunch(data, month);
    document.getElementById("launch-chart").innerHTML = chart(data, month);
    const scroller = document.getElementById("launch-chart");
    scroller.scrollLeft = (46 + 64 * (month - 1) + 32) / 840 * scroller.scrollWidth - scroller.clientWidth / 2;
    document.getElementById("launch-selection-summary").textContent = `${MONTHS[month - 1]} launch · demand index ${number.format(result.selected.demandIndex)} · ${number.format(result.selected.temperatureC)}°C`;
    document.getElementById("launch-wait").textContent = result.wait === 0 ? "Immediate test" : `${result.wait} ${result.wait === 1 ? "month" : "months"} to wait`;
    document.getElementById("launch-test-month").textContent = `First strong-demand test: ${result.testMonth}${result.nextYear ? " next year" : ""}`;
    document.getElementById("launch-exposure").textContent = `${number.format(result.firstThreeAverage)} index`;
    document.getElementById("launch-exposure-label").textContent = `First 3 months · ${MONTHS[month - 1]}–${result.firstThreeEnd}`;
    document.getElementById("launch-tradeoff").textContent = tradeoff(result);
    const april = assessLaunch(data, 4), september = assessLaunch(data, 9);
    document.getElementById("launch-comparison").textContent = `April vs September: first-three-month demand averages ${number.format(april.firstThreeAverage)} vs ${number.format(september.firstThreeAverage)} (${number.format(april.firstThreeAverage - september.firstThreeAverage)} index points less exposure with September). The wait for a strong-demand test grows from ${april.wait} to ${september.wait} months.`;
    document.querySelectorAll("[data-launch-preset]").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.launchPreset) === month));
    });
  }
  async function load() {
    controls.disabled = true;
    results.hidden = true;
    retry.hidden = true;
    data = undefined;
    status.textContent = "Loading launch context…";
    try {
      const response = await fetch("data/app_data/launch_window.json");
      if (!response.ok) throw new Error("Launch data unavailable");
      data = validateLaunchData(await response.json());
      document.getElementById("launch-data-body").innerHTML = data.months.map((row) =>
        `<tr><th scope="row">${MONTHS[row.month - 1]}</th><td>${number.format(row.demandIndex)}</td><td>${number.format(row.temperatureC)}°C</td></tr>`).join("");
      document.getElementById("launch-method").textContent = `Source: ${data.source}. The source index uses ${data.indexBaseline} as its reference; values are preserved without renormalising. “Strong-demand test” means the next month at or above index ${data.demandTestThreshold}, including the launch month. This decision heuristic selects ${data.months.filter((row) => row.demandIndex >= data.demandTestThreshold).map((row) => MONTHS[row.month - 1]).join(", ")}; it is not an observed LUMEN validation date. Waits count calendar-month steps and wrap into next year. The first-three-month index is an unweighted mean, including launch month.`;
      controls.disabled = false;
      results.hidden = false;
      update();
      status.textContent = "Launch context ready";
    } catch {
      status.textContent = "Launch context unavailable. Could not load complete prepared monthly data. Retry loading.";
      retry.hidden = false;
    }
  }
  select.addEventListener("change", update);
  document.querySelectorAll("[data-launch-preset]").forEach((button) => button.addEventListener("click", () => {
    select.value = button.dataset.launchPreset;
    update();
  }));
  retry.addEventListener("click", load);
  await load();
}
