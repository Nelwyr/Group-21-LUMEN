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
