import { initialiseSimulator } from "./simulator-ui.js";
import { initialiseCities } from "./city-ui.js";
import { initialiseLaunchWindow } from "./launch-window.js";
import { initialisePricePositioning } from "./price-positioning.js";

const routes = new Set(["home", "simulator", "cities"]);
const defaultRoute = document.body.dataset.defaultRoute || "home";

function currentRoute() {
  const route = window.location.hash.replace("#", "");
  return routes.has(route) ? route : defaultRoute;
}

function renderRoute() {
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
  if (!window.location.hash || !routes.has(window.location.hash.slice(1))) {
    window.history.replaceState(null, "", `#${defaultRoute}`);
  }
  renderRoute();
  initialiseCities();
  initialiseSimulator();
  initialiseLaunchWindow();
  initialisePricePositioning();
});
