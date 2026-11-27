/*
 * Settings for the whole website, in one place. Loaded first on every page as window.NorthlightConfig.
 * Frozen: scripts read these values but cannot change them.
 */
(function (root) {
  "use strict";

  var config = {
    siteName: "Northlight Studio",

    // Files the pages read (relative to the site)
    healthUrl: "health.json",
    cloudPlanUrl: "northlight.cloud.json",

    // Everything the site keeps in localStorage starts with this prefix
    storagePrefix: "northlight-",

    // Friendly names for the records the site knows about (used on the data page)
    records: {
      "northlight-crm-v1": "CRM: leads, accounts, contacts, opportunities, cases",
      "northlight-helpdesk-v2": "Help desk tickets",
      "northlight-outbox-v1": "Automation outbox (alerts, never sent)",
      "northlight-logs-v1": "Site-wide activity log",
      "northlight-logs-users-v1": "Logs site accounts (password hashes)",
      "northlight-staff-v1": "Staff directory, hashes and one-time-code secrets"
    },

    // "Export all data"
    export: {
      fileNamePrefix: "northlight-data",   // northlight-data-2026-11-27-1430.json
      indent: 2                            // pretty-printed JSON
    },

    // The activity log keeps at most this many lines (oldest dropped)
    logs: { maxEntries: 1000 },

    // The quiet "healthy / version / build date" line at the foot of every page
    statusBar: { enabled: true, link: "settings.html" }
  };

  function freeze(o) {
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === "object") freeze(o[k]); });
    return Object.freeze(o);
  }

  root.NorthlightConfig = freeze(config);
  if (typeof module !== "undefined" && module.exports) module.exports = root.NorthlightConfig;
})(typeof window !== "undefined" ? window : globalThis);
