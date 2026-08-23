import {createElement} from "react";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";
import MobEditor from "../features/editors/MobEditor.jsx";
import {mountReactRoot} from "../lib/mount-react-root.js";

function MobEditorPage(props) {
    return createElement(PageErrorBoundary, null, createElement(MobEditor, props));
}

mountReactRoot({name: "mob-editor", Component: MobEditorPage});
