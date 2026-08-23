import {createElement} from "react";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";
import QuestEditor from "../features/editors/QuestEditor.jsx";
import {mountReactRoot} from "../lib/mount-react-root.js";

function QuestEditorPage(props) {
    return createElement(PageErrorBoundary, null, createElement(QuestEditor, props));
}

mountReactRoot({name: "quest-editor", Component: QuestEditorPage});
