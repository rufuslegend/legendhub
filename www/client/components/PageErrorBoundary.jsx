import {Component} from "react";

export default class PageErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = {hasError: false};
        this.reloadPage = this.reloadPage.bind(this);
    }

    static getDerivedStateFromError() {
        return {hasError: true};
    }

    reloadPage() {
        window.location.reload();
    }

    render() {
        if (!this.state.hasError)
            return this.props.children;

        return (
            <section role="alert" aria-live="assertive">
                <h1>Something went wrong</h1>
                <p>We could not load this page. Reload and try again.</p>
                <button type="button" onClick={this.reloadPage}>Reload page</button>
            </section>
        );
    }
}
