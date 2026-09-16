import { initialiseStoryRecommendation } from "./story-recommendation.js";

const header = document.querySelector(".story-header");
const links = [...document.querySelectorAll("[data-section-link]")];
const sections = links.map((link) => document.querySelector(link.hash));
let scheduled = false;

function updateActiveSection() {
  // The current section is the one crossing the reading line below the navbar.
  const readingLine = header.getBoundingClientRect().bottom + 32;
  let active = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= readingLine) active = section;
  }
  links.forEach((link) => {
    if (link.hash === `#${active.id}`) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
  scheduled = false;
}

function scheduleUpdate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(updateActiveSection);
}

function measureHeader() {
  document.documentElement.style.setProperty("--story-header-height", `${header.getBoundingClientRect().height}px`);
  scheduleUpdate();
}

measureHeader();
new ResizeObserver(measureHeader).observe(header);
window.addEventListener("scroll", scheduleUpdate, { passive: true });
window.addEventListener("resize", scheduleUpdate);
window.addEventListener("hashchange", scheduleUpdate);

// Resolve direct section URLs after measuring the wrapped navbar. Native links
// handle subsequent scrolling, browser history and the CSS motion preference.
const initialSection = sections.find((section) => `#${section.id}` === location.hash);
if (initialSection) initialSection.scrollIntoView({ behavior: "instant" });
updateActiveSection();

// Loaded copy can change section heights on mobile. Keep an untouched direct
// anchor aligned, but never pull a reader back after they start interacting.
const initialHash = location.hash;
let interacted = false;
const interactionEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
const markInteraction = () => { interacted = true; };
interactionEvents.forEach((type) => window.addEventListener(type, markInteraction, { passive: true }));
await initialiseStoryRecommendation();
interactionEvents.forEach((type) => window.removeEventListener(type, markInteraction));
if (initialSection && location.hash === initialHash && !interacted) {
  initialSection.scrollIntoView({ behavior: "instant" });
}
updateActiveSection();
