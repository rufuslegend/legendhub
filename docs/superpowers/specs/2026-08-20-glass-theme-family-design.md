# Glass Theme Family Design

## Goal

Bring lmproxy's complete glass color family into LegendHUB while keeping Glass Blue as the default and presenting the five related choices in a compact, accessible Glass submenu.

## Theme choices

The chooser keeps the existing top-level Light, Dark, and Solarized Dark choices. Glass becomes an inline expandable group containing Blue, Emerald, Ruby, Amethyst, and Amber. The group opens on click or keyboard activation, exposes its state with `aria-expanded`, and uses a right-pointing caret when closed and a downward caret when open. This inline treatment avoids hover-only behavior and off-screen nested flyouts on mobile.

Each choice continues to call the existing `setTheme` behavior. Theme slugs are `glass-blue`, `glass-emerald`, `glass-ruby`, `glass-amethyst`, and `glass-amber`. Applying a theme remains immediate; the preference cookie remains consent-gated. Existing `glass-blue` cookies and the no-cookie default remain unchanged.

## Styling architecture

LegendHUB will use one shared glass structural skin. Five small palette partials define hue-specific Sass values copied from lmproxy's Blue, Emerald, Ruby, Amethyst, and Amber kits. Each `bootstrap-glass-<hue>.scss` entrypoint imports its palette, the shared Bootstrap theme variables, Bootstrap itself, LegendHUB custom styles, and the shared glass chrome.

The palettes retain lmproxy's matching luminance structure, including border, glow, wash, ink, backdrop, surface, well, focus, header gradient, button gradient, and hover values. Layout and component rules remain shared so future fixes cannot drift between hues.

## Build and compatibility

The CSS pipeline compiles, prefixes, minifies, source-maps, and copies all five glass bundles. Generated minified assets live alongside the existing themes under `www/src/public/css`. Glass Blue's output filename, default selection, browser metadata, and cookie slug do not change.

## Verification

Automated tests will prove:

- the controller exposes the five glass hues separately from standard themes;
- all glass choices resolve to the correct stylesheet and consent-gated cookie slug;
- both header render paths contain the accessible click/tap submenu contract;
- each palette contains its approved lmproxy values while structural rules remain shared;
- all generated CSS, minified CSS, maps, and copied public assets exist and match;
- Columns and Filters picker surfaces stay dark and integrated in every glass hue;
- the complete existing web and Sass test suites still pass.

The player-facing changelog will mention the four new glass color choices and grouped theme menu.
