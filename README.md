# Northlight Studio

A website for Northlight Studio, a 25-person design studio. Plain HTML, CSS and JavaScript: no frameworks and no build step. All data is fake and is kept in the visitor's own browser (localStorage).

## Pages

| Page | What it does |
|---|---|
| [index.html](index.html) | Home page with services, FAQ and a contact form that runs the automation rules |
| [helpdesk.html](helpdesk.html) | Tickets with priority P1 to P3 and response targets |
| [crm.html](crm.html) | Leads, accounts, contacts, opportunities, support cases and a chart |
| [track.html](track.html) | Customers follow their request with a reference and their email |
| [troubleshoot.html](troubleshoot.html) | Step-by-step "no internet" troubleshooter and PC tools |
| [staff.html](staff.html) | Learning model of password + one-time-code sign-in |
| [automation.html](automation.html) | The rules in [rules.json](rules.json), the alert outbox and the rule log |
| [logs.html](logs.html) | Sign-up gated, append-only log of everything that happens on the site |
| [cloud.html](cloud.html) | The cloud plan drawn as a blueprint, checked live with the same rules as the deploy check, with a playground to break it |
| [settings.html](settings.html) | Version and health, settings, stored data, cloud plan and **Export all data** |

## Health, settings and data export

- [health.json](health.json): name, version and build date. A quiet status line at the foot of every page reads it.
- [config.js](config.js): the site settings in one place (file locations, storage prefix, export file name, log size).
- **Export all data** (on the data page) downloads every localStorage record as one JSON file. The file includes the fake demo accounts' password hashes and secrets, so keep it private.

## Cloud description and checks

[northlight.cloud.json](northlight.cloud.json) describes a resource group, a web app and a storage account, each with the tags `owner`, `env` and `cost-center`. It is a plan only: the site itself is hosted on GitHub Pages and nothing in it is created.

Two read-only Node scripts run on every deploy:

```
node tools/check-cloud.js          # exits 1 on a missing tag or a bad name, 2 if the file cannot be read
node tools/stamp-health.js --stamp # validates health.json and sets today's build date in the deployed copy
```

`tools/check-cloud.js` also runs in the browser: [cloud.html](cloud.html) loads it, so the page and the deploy check always give the same answer.

Naming rules: resource group `rg-northlight-<env>`, web app `app-northlight-<env>`, storage account `stnorthlight<env>` (lowercase letters and numbers only, 3 to 24 characters). `env` is `dev`, `test` or `prod` and must match the `env` tag. `cost-center` looks like `CC-1234` and `owner` is an email address.

## Tests

```
node --test tools/
```

Tests use fake command output and temporary files; nothing real is changed.

## Deployment

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml):

1. check the cloud description (`tools/check-cloud.js`)
2. check `health.json` and stamp the build date (`tools/stamp-health.js --stamp`)
3. publish the repository to GitHub Pages

If a check fails, the job stops and nothing is published.

One-time setup: in the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
