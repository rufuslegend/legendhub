import {createElement} from "react";
import {createRoot} from "react-dom/client";

function findNamedElements(document, attribute, name) {
    return Array.from(document.querySelectorAll(`[${attribute}]`)).filter(function(element) {
        return element.getAttribute(attribute) === name;
    });
}

export function readRootProps({name, document}) {
    const roots = findNamedElements(document, "data-react-root", name);

    if (roots.length === 0)
        throw new Error(`Missing React root "${name}".`);
    if (roots.length > 1)
        throw new Error(`Duplicate React root "${name}".`);

    const propsElements = findNamedElements(document, "data-react-props", name);

    if (propsElements.length > 1)
        throw new Error(`Duplicate React props "${name}".`);
    if (propsElements.length === 0)
        return {root: roots[0], props: {}};

    try {
        return {root: roots[0], props: JSON.parse(propsElements[0].textContent)};
    }
    catch (_error) {
        throw new Error(`Invalid React props "${name}".`);
    }
}

export function mountReactRoot({name, Component, document = window.document}) {
    const {root, props} = readRootProps({name, document});
    const reactRoot = createRoot(root, {identifierPrefix: `${name}-`});

    reactRoot.render(createElement(Component, props));
    return reactRoot;
}
