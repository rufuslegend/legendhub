"use strict";

const os = require("node:os");

const {chromium} = require("@playwright/test");
const {PNG} = require("pngjs");

const fulfillLocalBrowserScript = require("../../accessibility/support/local-browser-scripts");
const {buildCaptureMatrix, validateManifest} = require("./config");
const {comparePngBuffers} = require("./images");
const {writeParityReport} = require("./report");
const fulfillReferenceBrowserScript = require("./reference-browser-scripts");
const {SCENARIOS} = require("./scenarios");
const {captureStructuralTargets, compareStructuralSnapshots} = require("./structure");

const BUILDER_LISTS = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*Hero~Caster~0U0m0U0U0U0U000000___0000000000000000000f__00g_______________________________*Scout~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
const CAPTCHA_HOSTS = new Set([
    "www.google.com",
    "www.gstatic.com",
    "www.recaptcha.net"
]);
const CAPTURE_STYLES = `
*, *::before, *::after {
    animation: none !important;
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
    transition: none !important;
}
html { scroll-behavior: auto !important; }
`;

function selectorFor(value, side) {
    return typeof value === "string" ? value : value[side];
}

function firstLine(error) {
    return String(error?.message || error || "unknown error").split("\n", 1)[0];
}

function lexicallyRedactUrl(url) {
    const privateTail = url.search(/[?#]/u);
    const withoutPrivateTail = privateTail === -1 ? url : url.slice(0, privateTail);
    const schemeEnd = withoutPrivateTail.indexOf("://") + 3;
    const pathStart = withoutPrivateTail.indexOf("/", schemeEnd);
    const authorityEnd = pathStart === -1 ? withoutPrivateTail.length : pathStart;
    const authority = withoutPrivateTail.slice(schemeEnd, authorityEnd);
    const userinfoEnd = authority.lastIndexOf("@");
    const redactedAuthority = userinfoEnd === -1 ? authority : authority.slice(userinfoEnd + 1);
    return `${withoutPrivateTail.slice(0, schemeEnd)}${redactedAuthority}${withoutPrivateTail.slice(authorityEnd)}`;
}

function sanitizeErrorMessage(error) {
    return firstLine(error).replace(/https?:\/\/[^\s<>"']+/giu, function(rawUrl) {
        let suffix = "";
        let candidate = rawUrl;
        while (/[\])},.;!?]$/.test(candidate)) {
            suffix = `${candidate.slice(-1)}${suffix}`;
            candidate = candidate.slice(0, -1);
        }
        try {
            const parsed = new URL(candidate);
            return `${parsed.origin}${parsed.pathname}${suffix}`;
        } catch {
            return `${lexicallyRedactUrl(candidate)}${suffix}`;
        }
    });
}

function safeRequestPath(request) {
    try {
        const parsed = new URL(request.url());
        return `${request.method()} ${parsed.pathname}`;
    } catch {
        return request.method();
    }
}

function transparentPng() {
    return PNG.sync.write(new PNG({width: 1, height: 1}));
}

function hasCaptchaMask(scenario) {
    return (scenario.masks || []).some(function(mask) {
        return mask.kind === "captcha";
    });
}

function sameOrigin(url, baseUrl) {
    try {
        return new URL(url).origin === new URL(baseUrl).origin;
    } catch {
        return false;
    }
}

async function installRequestPolicy(context, baseUrl, scenario, side) {
    const allowCaptcha = hasCaptchaMask(scenario);
    await context.route(/^https?:\/\//, async function(route) {
        const requestUrl = route.request().url();
        if (sameOrigin(requestUrl, baseUrl))
            return route.continue();
        if (side === "reference" && await fulfillReferenceBrowserScript(route))
            return;
        const hostname = new URL(requestUrl).hostname;
        if (allowCaptcha && CAPTCHA_HOSTS.has(hostname))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
}

function observePage(page, baseUrl) {
    const errors = [];
    let inFlight = 0;
    let idleSince = Date.now();

    function requestStarted(request) {
        if (!sameOrigin(request.url(), baseUrl))
            return;
        inFlight += 1;
        idleSince = 0;
    }

    function requestEnded(request) {
        if (!sameOrigin(request.url(), baseUrl))
            return;
        inFlight = Math.max(0, inFlight - 1);
        if (inFlight === 0)
            idleSince = Date.now();
    }

    page.on("request", requestStarted);
    page.on("requestfinished", requestEnded);
    page.on("requestfailed", function(request) {
        requestEnded(request);
        if (sameOrigin(request.url(), baseUrl))
            errors.push(`application request failed: ${safeRequestPath(request)}`);
    });
    page.on("response", function(response) {
        if (sameOrigin(response.url(), baseUrl) && response.status() >= 400)
            errors.push(`HTTP ${response.status()}: ${safeRequestPath(response.request())}`);
    });
    page.on("console", function(message) {
        const locationUrl = message.location().url;
        if (message.type() === "error" && (!locationUrl || sameOrigin(locationUrl, baseUrl)))
            errors.push("browser console error");
    });
    page.on("pageerror", function(error) {
        errors.push(`page error: ${error?.name || "Error"}`);
    });

    return {
        errors,
        idleFor: function() {
            return inFlight === 0 && idleSince ? Date.now() - idleSince : 0;
        }
    };
}

async function waitForNetworkIdle(observer, idleMilliseconds = 250, timeoutMilliseconds = 10000) {
    const startedAt = Date.now();
    while (observer.idleFor() < idleMilliseconds) {
        if (Date.now() - startedAt > timeoutMilliseconds)
            throw new Error(`same-origin requests did not become idle for ${idleMilliseconds} ms`);
        await new Promise(function(resolve) { setTimeout(resolve, 25); });
    }
}

async function requireSuccessfulNavigation(response, label) {
    if (!response)
        throw new Error(`${label} did not return an HTTP response`);
    if (response.status() >= 400)
        throw new Error(`${label} returned HTTP ${response.status()}`);
}

async function visibleLocator(page, selector, label) {
    const matches = page.locator(selector);
    const visible = matches.filter({visible: true});
    await visible.first().waitFor({state: "visible", timeout: 10000});
    if (await visible.count() === 0)
        throw new Error(`${label} is missing or hidden: ${selector}`);
    return visible.first();
}

async function authenticate(page, baseUrl) {
    const loginUrl = new URL("/login.html", baseUrl).href;
    await requireSuccessfulNavigation(await page.goto(loginUrl), "login navigation");
    await visibleLocator(page, "#login_username", "login username");
    await page.locator("#login_username").fill("ParityEditor");
    await page.locator("#login_password").fill("ParityPass!");
    await Promise.all([
        page.waitForURL(function(url) {
            return url.pathname !== "/login.html";
        }, {timeout: 10000}),
        page.locator('form[name="login"] button[type="submit"]').click()
    ]);
    if (new URL(page.url()).pathname === "/login.html")
        throw new Error("authentication did not redirect away from /login.html");
}

async function executeAction(page, action, side) {
    const selector = selectorFor(action.target, side);
    const locator = await visibleLocator(page, selector, `${action.type} action target`);
    switch (action.type) {
    case "click":
        await locator.click();
        return;
    case "fill":
        if (typeof action.value !== "string")
            throw new Error("fill action requires a string value");
        await locator.fill(action.value);
        return;
    case "hover":
        await locator.hover();
        return;
    case "press":
        if (typeof action.key !== "string" || action.key === "")
            throw new Error("press action requires a key");
        await locator.press(action.key);
        return;
    case "select":
        if (typeof action.value !== "string")
            throw new Error("select action requires a string value");
        await locator.selectOption(action.value);
        return;
    case "set-builder-state": {
        await page.evaluate(function({lists}) {
            localStorage.setItem("cln", lists);
            localStorage.setItem("scl", "Hero!Tank");
        }, {lists: BUILDER_LISTS});
        await requireSuccessfulNavigation(await page.reload(), "Builder state reload");
        return;
    }
    default:
        throw new Error(`unsupported action type: ${action.type}`);
    }
}

function sameBox(left, right) {
    if (!left || !right)
        return false;
    return ["x", "y", "width", "height"].every(function(property) {
        return Math.abs(left[property] - right[property]) < 0.01;
    });
}

async function waitForSettledBox(locator, label) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const boxes = await locator.evaluate(function(element) {
            function box() {
                const rect = element.getBoundingClientRect();
                return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
            }
            return new Promise(function(resolve) {
                requestAnimationFrame(function() {
                    const first = box();
                    requestAnimationFrame(function() {
                        resolve([first, box()]);
                    });
                });
            });
        });
        if (sameBox(boxes[0], boxes[1]))
            return;
    }
    throw new Error(`${label} did not settle at a stable bounding box`);
}

async function waitForPageLayoutSettled(page) {
    await page.evaluate(function(timeoutMilliseconds) {
        function elementMetrics(element) {
            const rect = element.getBoundingClientRect();
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                scrollWidth: element.scrollWidth,
                scrollHeight: element.scrollHeight,
                clientWidth: element.clientWidth,
                clientHeight: element.clientHeight
            };
        }
        function pageMetrics() {
            return {
                scrollX,
                scrollY,
                document: elementMetrics(document.documentElement),
                body: elementMetrics(document.body)
            };
        }
        return new Promise(function(resolve, reject) {
            const startedAt = performance.now();
            let previous;
            function sample() {
                const current = pageMetrics();
                if (previous && JSON.stringify(previous) === JSON.stringify(current)) {
                    resolve();
                    return;
                }
                if (performance.now() - startedAt > timeoutMilliseconds) {
                    reject(new Error("full-page layout did not settle across two animation frames"));
                    return;
                }
                previous = current;
                requestAnimationFrame(sample);
            }
            requestAnimationFrame(sample);
        });
    }, 10000);
}

async function captureSide(context, entry, side, baseUrl) {
    const {scenario, theme, viewportName} = entry;
    const page = await context.newPage();
    const observer = observePage(page, baseUrl);
    let png;
    let structuralSnapshots = [];

    try {
        await page.addInitScript(({lists}) => {
            localStorage.setItem("cln", lists);
            localStorage.setItem("scl", "Hero!Tank");
        }, {lists: BUILDER_LISTS});
        if (scenario.authenticated)
            await authenticate(page, baseUrl);

        const response = await page.goto(new URL(scenario.route, baseUrl).href);
        await requireSuccessfulNavigation(response, "scenario navigation");
        await visibleLocator(page, selectorFor(scenario.ready, side), "readiness selector");
        for (const action of scenario.actions || [])
            await executeAction(page, action, side);
        await page.evaluate(async function() {
            await document.fonts.ready;
        });
        await waitForNetworkIdle(observer);
        await page.addStyleTag({content: CAPTURE_STYLES});

        const masks = [];
        for (const mask of scenario.masks || []) {
            const locator = await visibleLocator(page, selectorFor(mask.selector, side), `${mask.kind} mask`);
            await waitForSettledBox(locator, `${mask.kind} mask`);
            masks.push(locator);
        }

        if (scenario.capture.kind === "locator") {
            const locator = await visibleLocator(page, selectorFor(scenario.capture.selector, side), "capture locator");
            await waitForSettledBox(locator, "capture locator");
            png = await locator.screenshot({animations: "disabled", mask: masks});
        } else {
            await waitForPageLayoutSettled(page);
            png = await page.screenshot({animations: "disabled", fullPage: true, mask: masks});
        }
        structuralSnapshots = await captureStructuralTargets(page, scenario, side, {
            scenario: scenario.name,
            theme,
            viewport: viewportName
        });
    } catch (error) {
        observer.errors.push(firstLine(error));
    }

    return {
        png: png || transparentPng(),
        structuralSnapshots,
        errors: [
            ...Array.from(new Set(observer.errors)).map(function(message) {
                return {side, message};
            }),
            ...structuralSnapshots.filter(function(snapshot) {
                return snapshot.present === false;
            }).map(function(snapshot) {
                return {side, message: `missing structural target: ${snapshot.target}`};
            })
        ]
    };
}

async function createContext(browser, entry, baseUrl, side) {
    const context = await browser.newContext({
        viewport: entry.viewport,
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "America/Chicago",
        reducedMotion: "reduce"
    });
    await context.addCookies([
        {name: "theme", value: entry.theme, url: baseUrl},
        {name: "cookie-consent", value: "true", url: baseUrl}
    ]);
    await installRequestPolicy(context, baseUrl, entry.scenario, side);
    return context;
}

async function captureEntry(browser, entry, options, activeContexts) {
    const contexts = [];
    const blank = transparentPng();
    const identity = {
        scenario: entry.scenario.name,
        theme: entry.theme,
        viewport: entry.viewportName
    };
    let reference = {png: blank, structuralSnapshots: [], errors: []};
    let candidate = {png: blank, structuralSnapshots: [], errors: []};
    const closeErrors = [];

    try {
        const referenceContext = await createContext(browser, entry, options.referenceBaseUrl, "reference");
        contexts.push({context: referenceContext, side: "reference"});
        activeContexts.add(referenceContext);
        const candidateContext = await createContext(browser, entry, options.candidateBaseUrl, "candidate");
        contexts.push({context: candidateContext, side: "candidate"});
        activeContexts.add(candidateContext);
        reference = await captureSide(referenceContext, entry, "reference", options.referenceBaseUrl);
        candidate = await captureSide(candidateContext, entry, "candidate", options.candidateBaseUrl);
    } catch (error) {
        closeErrors.push({side: "harness", message: firstLine(error)});
    } finally {
        for (const {context, side} of contexts.reverse()) {
            try {
                await context.close();
            } catch (error) {
                closeErrors.push({side, message: `context close failed: ${firstLine(error)}`});
            } finally {
                activeContexts.delete(context);
            }
        }
    }

    const image = await comparePngBuffers(reference.png, candidate.png);
    return {
        ...identity,
        referencePng: reference.png,
        candidatePng: candidate.png,
        diffPng: image.diffPng,
        image,
        referenceStructuralSnapshots: reference.structuralSnapshots,
        candidateStructuralSnapshots: candidate.structuralSnapshots,
        structuralFindings: [],
        errors: [...reference.errors, ...candidate.errors, ...closeErrors]
    };
}

function attachConsolidatedFindings(results) {
    const referenceSnapshots = results.flatMap(function(result) {
        return result.referenceStructuralSnapshots;
    });
    const candidateSnapshots = results.flatMap(function(result) {
        return result.candidateStructuralSnapshots;
    });
    const findings = compareStructuralSnapshots(referenceSnapshots, candidateSnapshots);
    for (const finding of findings) {
        const representative = results.find(function(result) {
            return result.scenario === finding.scenario && finding.occurrences.some(function(occurrence) {
                return occurrence.theme === result.theme && occurrence.viewport === result.viewport;
            });
        });
        if (representative)
            representative.structuralFindings.push(finding);
    }
}

function findingCount(results) {
    return results.reduce(function(total, result) {
        return total + (result.image.diffPixels > 0 ? 1 : 0) + result.structuralFindings.length;
    }, 0);
}

function errorCount(results) {
    return results.reduce(function(total, result) {
        return total + result.errors.length;
    }, 0);
}

function sanitizeResultErrors(results) {
    for (const result of results) {
        result.errors = result.errors.map(function(error) {
            return {side: error.side, message: sanitizeErrorMessage(error.message)};
        });
    }
}

async function runVisualParity(options) {
    const scenarios = validateManifest(options.scenarios || SCENARIOS);
    const matrix = buildCaptureMatrix({mode: options.mode, scenarios});
    const activeContexts = new Set();
    const results = [];
    let browser;
    let chromiumVersion = "unavailable";
    let harnessError;

    try {
        browser = await (options.browserType || chromium).launch({headless: true});
        chromiumVersion = browser.version();
        for (const entry of matrix)
            results.push(await captureEntry(browser, entry, options, activeContexts));
    } catch (error) {
        harnessError = firstLine(error);
    } finally {
        for (const context of activeContexts) {
            try {
                await context.close();
            } catch (error) {
                harnessError ||= `context close failed: ${firstLine(error)}`;
            }
        }
        if (browser) {
            try {
                await browser.close();
            } catch (error) {
                harnessError ||= `browser close failed: ${firstLine(error)}`;
            }
        }
    }

    if (harnessError) {
        const blank = transparentPng();
        const remaining = matrix.slice(results.length);
        for (const entry of remaining) {
            const image = await comparePngBuffers(blank, blank);
            results.push({
                scenario: entry.scenario.name,
                theme: entry.theme,
                viewport: entry.viewportName,
                referencePng: blank,
                candidatePng: blank,
                diffPng: image.diffPng,
                image,
                referenceStructuralSnapshots: [],
                candidateStructuralSnapshots: [],
                structuralFindings: [],
                errors: [{side: "harness", message: harnessError}]
            });
        }
        if (remaining.length === 0 && results.length > 0)
            results[0].errors.push({side: "harness", message: harnessError});
    }

    attachConsolidatedFindings(results);
    sanitizeResultErrors(results);
    const metadata = {
        referenceSha: options.referenceSha,
        candidateSha: options.candidateSha,
        generatedAt: new Date().toISOString(),
        mode: options.mode,
        playwrightVersion: require("@playwright/test/package.json").version,
        chromiumVersion,
        operatingSystem: `${os.platform()} ${os.arch()}`
    };
    const reportPaths = writeParityReport({outputDir: options.outputDir, metadata, results});
    const findings = findingCount(results);
    const errors = errorCount(results);
    return {
        exitCode: errors > 0 ? 2 : (options.failOnDiff && findings > 0 ? 1 : 0),
        metadata,
        results,
        reportPaths,
        findingCount: findings,
        errorCount: errors
    };
}

module.exports = {BUILDER_LISTS, runVisualParity};
