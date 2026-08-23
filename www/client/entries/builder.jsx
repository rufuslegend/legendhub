import {createElement} from "react";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";
import Builder from "../features/builder/Builder.jsx";
import {mountReactRoot} from "../lib/mount-react-root.js";

mountReactRoot({name: "builder", Component: function BuilderPage(props) { return createElement(PageErrorBoundary, null, createElement(Builder, props)); }});
