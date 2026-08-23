import {createElement} from "react";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";
import {mountReactRoot} from "../lib/mount-react-root.js";
import ItemSearch from "../features/items/ItemSearch.jsx";

mountReactRoot({
    name: "items",
    Component: function ItemsPage(props) {
        return createElement(PageErrorBoundary, null, createElement(ItemSearch, props));
    }
});
