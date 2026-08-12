# Shared Column Picker Desktop Width Design

**Date:** 2026-08-12

## Goal

Reduce the shared Columns picker from roughly 90 percent of the viewport to
roughly half of the viewport on tablet and desktop screens, while preserving
its current mobile usability and four-stack organization.

## Scope

The change applies only to the shared Columns picker identified by
`columnsModalLabel`. It affects every page that renders the shared picker,
including Builder and Items. Other `modal-xl` dialogs keep their existing
dimensions.

The existing toolbar, category headings, category surfaces, option density,
selection behavior, reset behavior, stack membership, and category fallback
behavior remain unchanged.

## Responsive behavior

At viewport widths of 768px and above, the Columns picker dialog is centered
at 50 percent of the viewport width. The rule has no fixed pixel cap, so the
dialog remains proportional on larger displays.

Below 768px, the picker retains Bootstrap's current nearly full-width mobile
dialog behavior. The existing auto-fitting grid remains responsible for
reducing the number of visible tracks when four tracks cannot fit.

## Implementation boundary

Add a Columns-modal-scoped desktop rule in `css/scss/custom/_custom.scss`.
The rule overrides the repository's general 90-percent `.modal-xl` width only
for the shared picker. Rebuild all four generated themes and copy their
minified outputs into the web application through the existing CSS build.

No template, controller, data, or column-selection changes are required.

## Verification

Extend the shared Columns modal tests to assert that every compiled theme:

- sets the picker dialog to 50 percent width at the existing 768px desktop
  breakpoint;
- removes a fixed maximum width for that scoped dialog;
- leaves the general `.modal-xl` rule unchanged; and
- retains the existing responsive four-stack picker rules.

Run the focused Columns modal test through a failing-test-first cycle, then
run the complete CSS lint/build and web test suites. Visually verify Builder
and Items at desktop and phone widths before considering the change ready for
deployment.
