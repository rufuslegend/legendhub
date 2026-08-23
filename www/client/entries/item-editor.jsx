import {createElement} from "react";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";
import ItemEditor from "../features/editors/ItemEditor.jsx";
import {mountReactRoot} from "../lib/mount-react-root.js";

function ItemEditorPage(props) {
    return createElement(PageErrorBoundary, null, createElement(ItemEditor, props));
}

mountReactRoot({name: "item-editor", Component: ItemEditorPage});
