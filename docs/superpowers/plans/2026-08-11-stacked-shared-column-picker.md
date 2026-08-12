# Stacked Shared Column Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arrange the shared column picker's nine known categories into five responsive stacks while preserving every existing column-selection behavior and every unknown future category.

**Architecture:** Keep grouping entirely in the shared EJS presentation layer: build a name lookup, resolve the approved stack definition, and append unknown categories as single-card fallback stacks. Keep the existing CSS Grid as the responsive outer layout and add a modal-scoped flex-column wrapper for vertical card spacing; rebuild all four theme artifact sets from the SCSS source.

**Tech Stack:** EJS, AngularJS template bindings, SCSS, Bootstrap 4, Node.js built-in test runner, npm CSS build pipeline

## Global Constraints

- Apply the change everywhere through `www/src/views/shared/columnsModal.ejs`; do not duplicate picker markup in builder or item-search pages.
- Render known stacks in this exact order: `Basic`; `Main, Limits`; `Regen, Melee`; `Tank, Mage, Ranged`; `Weapon`.
- Keep the displayed and underlying category name `Weapon` singular.
- Omit missing known categories and empty known stacks.
- Append every unknown category in its own stack after the known stacks, preserving unknown categories' server-provided order.
- Preserve category-local `getItemStatInfo` order and all AngularJS selection/reset bindings.
- Keep `modal-xl`, `minmax(12rem, 1fr)` outer tracks, `1rem` spacing, `1rem` headings, `0.875rem` option labels, and `0.5rem 0.75rem` option padding.
- Keep the application version at `2.6.1-beta`; do not create, move, delete, or reuse a release tag.
- Do not modify root `docker-compose-prod.yaml`.
- Do not push, publish images, or deploy without separate authorization for those actions.

---

## File Map

- `www/src/views/shared/columnsModal.ejs`: builds deterministic category stacks and renders each stack around the existing category-card markup.
- `www/test/columns-modal.test.js`: renders the real shared template and asserts known grouping, missing-category behavior, unknown fallbacks, bindings, native buttons, and compiled CSS contracts.
- `css/scss/custom/_custom.scss`: adds Columns-modal-scoped vertical layout to `.columns-picker-stack`.
- `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.css`: generated expanded theme CSS and source maps.
- `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.min.css`: generated minified theme CSS and source maps.
- `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}.min.css`: copies of generated minified CSS and source maps served by the app.
- `CHANGELOG.md`: records the refined grouped-stack layout under `2.6.1-beta`.

### Task 1: Deterministic Template Grouping

**Files:**
- Modify: `www/test/columns-modal.test.js`
- Modify: `www/src/views/shared/columnsModal.ejs`

**Interfaces:**
- Consumes: `vm.itemStatCategories: Array<{name: string, getItemStatInfo: Array<{display: string, short: string}>}>` and `vm.selectedColumns: string[]`.
- Produces: `.columns-picker-stack` elements containing one or more existing `.columns-picker-category` sections; each source category is rendered according to the known-stack and fallback rules.

- [ ] **Step 1: Add rendering and stack-extraction test helpers**

In `www/test/columns-modal.test.js`, replace the one fixed render fixture with helpers that still use the real EJS template:

```js
function category(name, short = name) {
    return {
        name,
        getItemStatInfo: [{display: `${name} Stat`, short}]
    };
}

function renderCategories(categories, selectedColumns = []) {
    return ejs.render(
        fs.readFileSync(templatePath, "utf8"),
        {
            vm: {
                itemStatCategories: categories,
                selectedColumns
            }
        },
        {filename: templatePath}
    );
}

function renderedStackNames(html) {
    const starts = Array.from(html.matchAll(
        /<div class="columns-picker-stack">/g), match => match.index);

    return starts.map((start, index) => {
        const end = starts[index + 1] ?? html.length;
        return Array.from(
            html.slice(start, end).matchAll(
                /<h6 class="columns-picker-category-title">([^<]+)<\/h6>/g),
            match => match[1]
        );
    });
}

const rendered = renderCategories([
    category("Basic", "Str"),
    category("Tank", "HP")
], ["Str"]);
```

- [ ] **Step 2: Write failing known-stack and fallback behavior tests**

Add these tests before changing the template:

```js
test("shared Columns modal renders the approved category stacks", function() {
    const html = renderCategories([
        "Basic", "Main", "Limits", "Regen", "Melee", "Mage", "Tank",
        "Ranged", "Weapon"
    ].map(name => category(name)));

    assert.deepEqual(renderedStackNames(html), [
        ["Basic"],
        ["Main", "Limits"],
        ["Regen", "Melee"],
        ["Tank", "Mage", "Ranged"],
        ["Weapon"]
    ]);
});

test("shared Columns modal omits missing known categories and empty stacks", function() {
    const html = renderCategories([
        category("Basic"),
        category("Limits"),
        category("Weapon")
    ]);

    assert.deepEqual(renderedStackNames(html), [
        ["Basic"],
        ["Limits"],
        ["Weapon"]
    ]);
});

test("shared Columns modal appends unknown categories in independent stacks", function() {
    const html = renderCategories([
        category("Future Two"),
        category("Tank"),
        category("Future One"),
        category("Basic")
    ]);

    assert.deepEqual(renderedStackNames(html), [
        ["Basic"],
        ["Tank"],
        ["Future Two"],
        ["Future One"]
    ]);
});
```

These tests catch a missing stack wrapper, wrong known ordering (especially Mage before Tank), empty known stacks, dropped unknown categories, or reordered unknown categories.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
node --test test/columns-modal.test.js
```

from `www/`.

Expected: the three new tests fail because the current template has no `.columns-picker-stack` wrappers, so `renderedStackNames()` returns an empty array.

- [ ] **Step 4: Implement the minimal EJS grouping logic**

At the beginning of the picker-grid block in `www/src/views/shared/columnsModal.ejs`, construct the known stacks and fallbacks:

```ejs
<%
const knownStackNames = [
    ["Basic"],
    ["Main", "Limits"],
    ["Regen", "Melee"],
    ["Tank", "Mage", "Ranged"],
    ["Weapon"]
];
const knownNames = new Set(knownStackNames.flat());
const categoriesByName = new Map();

for (const category of vm.itemStatCategories) {
    if (knownNames.has(category.name) && !categoriesByName.has(category.name)) {
        categoriesByName.set(category.name, category);
    }
}

const categoryStacks = knownStackNames
    .map(names => names
        .map(name => categoriesByName.get(name))
        .filter(Boolean))
    .filter(stack => stack.length > 0);

for (const category of vm.itemStatCategories) {
    if (!knownNames.has(category.name)) {
        categoryStacks.push([category]);
    }
}
%>
```

Replace the single category loop with nested stack/category loops:

```ejs
<% for (const categoryStack of categoryStacks) { %>
    <div class="columns-picker-stack">
    <% for (const category of categoryStack) { %>
        <section class="columns-picker-category list-group-item">
            <h6 class="columns-picker-category-title"><%= category.name _%></h6>
            <div class="list-group list-group-flush">
            <% for (const stat of category.getItemStatInfo) { %>
                <button ng-click="toggleColumn('<%- stat.short _%>')" type="button" class="columns-picker-option list-group-item list-group-item-action list-group-item-light">
                    <span class="d-flex align-items-center justify-content-between">
                        <span><%= stat.display _%></span>
                        <i ng-class="{'text-success fa-check': showColumn('<%- stat.short _%>', <%- vm.selectedColumns.includes(stat.short) _%>), 'text-danger fa-times': !showColumn('<%- stat.short _%>', <%- vm.selectedColumns.includes(stat.short) _%>)}" class="fas ml-2"></i>
                    </span>
                </button>
            <% } %>
            </div>
        </section>
    <% } %>
    </div>
<% } %>
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run from `www/`:

```bash
node --test test/columns-modal.test.js
```

Expected: all template, native-button, and binding tests pass.

- [ ] **Step 6: Commit the template behavior**

```bash
git add www/src/views/shared/columnsModal.ejs www/test/columns-modal.test.js
git commit -m "feat: stack related column picker categories"
```

### Task 2: Responsive Stack Styling and Generated Themes

**Files:**
- Modify: `www/test/columns-modal.test.js`
- Modify: `css/scss/custom/_custom.scss`
- Generate: `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{css,css.map,min.css,min.css.map}`
- Generate: `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{min.css,min.css.map}`

**Interfaces:**
- Consumes: `.columns-picker-stack` wrappers produced by Task 1.
- Produces: a modal-scoped vertical flex layout with exactly `1rem` between category cards while the existing outer grid continues to wrap whole stacks.

- [ ] **Step 1: Write the failing compiled-style assertion**

Extend `compiled themes expose the responsive compact picker` in `www/test/columns-modal.test.js`:

```js
const stack = getPickerRule(css, String.raw`\.columns-picker-stack`);

assert.match(stack, /display:\s*flex;/);
assert.match(stack, /flex-direction:\s*column;/);
assert.match(stack, /gap:\s*1rem;/);
```

Keep the existing grid, title-size, option-size, and padding assertions.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `www/`:

```bash
node --test test/columns-modal.test.js
```

Expected: the compiled-theme test fails with `missing generated rule for \.columns-picker-stack`.

- [ ] **Step 3: Add the minimal modal-scoped SCSS**

Inside `.modal[aria-labelledby="columnsModalLabel"]` in `css/scss/custom/_custom.scss`, immediately after `.columns-picker-grid`, add:

```scss
.columns-picker-stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
```

- [ ] **Step 4: Lint and build every theme**

Run from the repository root:

```bash
npm run build --prefix css
```

Expected: stylelint, Sass compilation, prefixing, minification, and public-asset copying all exit successfully.

- [ ] **Step 5: Run focused picker and Glass Blue tests**

Run from `www/`:

```bash
node --test test/columns-modal.test.js test/glass-blue-theme.test.js
```

Expected: all focused tests pass, including all four theme stack rules and byte-identical public minified copies.

- [ ] **Step 6: Commit SCSS, tests, and generated assets**

```bash
git add \
  css/scss/custom/_custom.scss \
  css/dist/css \
  www/src/public/css \
  www/test/columns-modal.test.js
git commit -m "style: keep picker category stacks together"
```

### Task 3: Changelog and Complete Verification

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the completed shared-picker behavior and generated assets from Tasks 1 and 2.
- Produces: an accurate public-facing `2.6.1-beta` release note and a verified branch ready for review, without publishing or deployment.

- [ ] **Step 1: Refine the existing changelog entry**

Under `## [2.6.1-beta]` → `### Changed`, replace the existing picker bullet with:

```markdown
- Reorganized the shared column picker into compact, responsive columns, stacking related stat categories together for easier scanning.
```

- [ ] **Step 2: Run the full web test suite**

Run from the repository root:

```bash
npm test --prefix www
```

Expected: all web tests pass, with only documented expected skips.

- [ ] **Step 3: Re-run CSS lint and generated-asset verification**

Run from the repository root:

```bash
npm test --prefix css
node --test test/columns-modal.test.js test/glass-blue-theme.test.js
```

Run the Node command from `www/`. Expected: CSS lint and all focused tests pass.

- [ ] **Step 4: Check whitespace and review only scoped changes**

```bash
git diff --check
git status --short
git diff -- \
  CHANGELOG.md \
  www/src/views/shared/columnsModal.ejs \
  www/test/columns-modal.test.js \
  css/scss/custom/_custom.scss
```

Expected: `git diff --check` is silent; the diff contains only the approved picker and changelog changes. Existing unrelated user-owned modifications and untracked files remain untouched.

- [ ] **Step 5: Commit the release note**

```bash
git add CHANGELOG.md
git commit -m "docs: record stacked column picker"
```

- [ ] **Step 6: Perform final branch verification**

```bash
npm test --prefix www
npm test --prefix css
git diff --check master...HEAD
git status --short --branch
```

Expected: tests and lint pass; the branch contains the design and implementation commits; only pre-existing unrelated working-tree paths remain dirty or untracked. Do not push, publish, or deploy during this task.
