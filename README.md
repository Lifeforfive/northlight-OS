# Northlight Studio

A minimal website for Northlight Studio, a 25-person design studio.

The site is a single static file, [index.html](index.html). It uses no frameworks and has no build step.

## Preview locally

Open `index.html` in a browser.

## Deployment

Every push to `main` triggers the GitHub Actions workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml). It publishes the repository contents to GitHub Pages.

One-time setup: in the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

The site is then served at `https://<owner>.github.io/<repo>/`.
