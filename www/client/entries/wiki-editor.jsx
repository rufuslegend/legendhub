import {createElement} from "react";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";
import WikiEditor from "../features/editors/WikiEditor.jsx";
import {mountReactRoot} from "../lib/mount-react-root.js";

function WikiEditorPage(props) {
    return createElement(PageErrorBoundary, null, createElement(WikiEditor, props));
}

mountReactRoot({name: "wiki-editor", Component: WikiEditorPage});
