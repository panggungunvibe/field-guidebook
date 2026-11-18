import { SITE } from "./site-config.js";

const escapeHTML = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// Keep initial HTML metadata in sync with the same content configuration used
// by the app, including production output and pages read before JavaScript runs.
export default {
  plugins: [{
    name: "guidebook-metadata",
    transformIndexHtml(html) {
      return html
        .replace(/<html lang="[^"]*">/, `<html lang="${escapeHTML(SITE.language)}">`)
        .replace(/<title>.*?<\/title>/, `<title>${escapeHTML(SITE.homeTitle)}</title>`)
        .replace(/<link rel="icon" href="[^"]*"\s*\/>/, `<link rel="icon" href="${escapeHTML(SITE.favicon)}" />`)
        .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHTML(SITE.description)}" />`);
    },
  }],
};
