/*
 * Runs first on every page.
 *  1. Marks the page as script-enabled (the styles use it for the fade-in effects).
 *  2. Refuses to be shown inside ANOTHER website's frame. That stops "clickjacking", where a hostile
 *     page hides this site in a frame and tricks someone into clicking its buttons.
 *     GitHub Pages cannot send the X-Frame-Options / frame-ancestors headers, so this script does it.
 *     Framing by this same site (same origin) is still allowed.
 */
(function () {
  "use strict";
  document.documentElement.classList.add("js");
  if (window.top === window.self) return;

  var foreign = false;
  try { void window.top.location.href; } catch (e) { foreign = true; }   // reading a different site's address throws

  if (foreign) {
    document.documentElement.style.display = "none";                      // show nothing
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* the browser may refuse; the page stays hidden */ }
  }
})();
