export function initializeEmailVerificationPrompt(
    document = globalThis.document,
    jquery = globalThis.jQuery
) {
    const prompt = document?.querySelector?.("[data-email-verification-prompt]");
    if (!prompt || !jquery?.fn?.modal)
        return;
    jquery(prompt).modal({backdrop: "static", keyboard: false, show: true});
}
