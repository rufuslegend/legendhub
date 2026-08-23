import {createElement} from "react";
import AccountSettings from "../features/account/AccountSettings.jsx";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";
import {mountReactRoot} from "../lib/mount-react-root.js";

function AccountPage(props) {
    return createElement(
        PageErrorBoundary,
        null,
        createElement(AccountSettings, props)
    );
}

mountReactRoot({
    name: "account-settings",
    Component: AccountPage
});
