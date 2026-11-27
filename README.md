# Northlight Studio

A minimal website for Northlight Studio, a 25-person design studio.

The site is a single static file, [index.html](index.html). It uses no frameworks and has no build step.

## Preview locally

Open `index.html` in a browser.

## Deployment

Every push to `main` triggers the GitHub Actions workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml). It publishes the repository contents to GitHub Pages.

One-time setup: in the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

The site is then served at `https://<owner>.github.io/<repo>/`.

## Help desk

[helpdesk.html](helpdesk.html) is a static help desk page with a searchable FAQ and a request form. GitHub Pages cannot run server code, so requests are saved only in the visitor's own browser (localStorage) and are not sent anywhere.
