import { initialiseSimulator } from "./simulator-ui.js";
import { initialisePricePositioning } from "./price-positioning.js";

const routes = new Set(["home", "simulator"]);
const defaultRoute = document.body.dataset.defaultRoute || "home";

function currentRoute() {
  const route = window.location.hash.replace("#", "");
  return routes.has(route) ? route : defaultRoute;
}

function renderRoute() {
  if (window.location.hash === "#cities") {
    window.location.replace("index.html#city");
    return;
  }
  const route = currentRoute();
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.hidden = view.dataset.view !== route;
  });
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    if (link.dataset.routeLink === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `${route === "home" ? "Home" : route === "simulator" ? "ROI scenarios" : "City prioritisation"} — LUMEN`;
}

window.addEventListener("hashchange", renderRoute);
window.addEventListener("DOMContentLoaded", () => {
  if (window.location.hash === "#cities") {
    window.location.replace("index.html#city");
    return;
  }
  if (!window.location.hash || !routes.has(window.location.hash.slice(1))) {
    window.history.replaceState(null, "", `#${defaultRoute}`);
  }
  renderRoute();
  initialiseSimulator();
  initialisePricePositioning();
});
