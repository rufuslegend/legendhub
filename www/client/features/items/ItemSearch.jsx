import {useCallback, useEffect, useReducer, useRef, useState} from "react";
import ColumnsDialog from "../../components/ColumnsDialog.jsx";
import FiltersDialog from "../../components/FiltersDialog.jsx";
import Pagination from "../../components/Pagination.jsx";
import {getPageAccountPreferencesStore} from "../../lib/account-preferences-store.js";
import {parseCookieHeader} from "../../lib/cookies.js";
import {loadItems} from "./item-search-api.js";
import {columnsPreferenceCookie} from "./item-search-cookie.js";
import {createInitialItemSearchState, itemSearchReducer, searchUrl} from "./item-search-reducer.js";

function resultValue(item, stat, constants) {
    if (stat.type === "bool")
        return <i className={Number(item[stat.var]) === 1 ? "text-success fas fa-check" : "text-danger fas fa-times"} aria-label={Number(item[stat.var]) === 1 ? "yes" : "no"} />;
    if (stat.var === "slot") {
        const labels = (item.slots || [item.slot])
            .map(slot => constants.selectShortOptions.slot?.[slot])
            .filter(Boolean);
        return <span>{labels.join(", ")}</span>;
    }
    if (stat.type === "select")
        return <span style={stat.var === "alignRestriction" ? {whiteSpace: "pre"} : undefined}>{constants.selectShortOptions[stat.var]?.[item[stat.var]] || ""}</span>;
    return <span>{item[stat.var]}</span>;
}

export default function ItemSearch(props) {
    const preferenceStoreRef = useRef(getPageAccountPreferencesStore());
    const [state, dispatch] = useReducer(itemSearchReducer, {
        ...props,
        accountPreferences: preferenceStoreRef.current?.get?.() || null
    }, createInitialItemSearchState);
    const [columnsOpen, setColumnsOpen] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const abortRef = useRef(null);
    const columnsTriggerRef = useRef(null);
    const filtersTriggerRef = useRef(null);
    const requestIdRef = useRef(0);
    const closeColumns = useCallback(function() { setColumnsOpen(false); }, []);
    const closeFilters = useCallback(function() { setFiltersOpen(false); }, []);

    useEffect(() => () => abortRef.current?.abort(), []);
    useEffect(function() {
        function restoreFromHistory() {
            const params = new URLSearchParams(window.location.search);
            runSearch({
                search: params.has("search") ? params.get("search") : null,
                filters: Object.fromEntries((params.get("filters") || "").split(",").filter(Boolean).map(value => { const [field, ...values] = value.split("_"); return [field, values]; })),
                sortBy: params.get("sortBy"), sortAsc: params.get("sortAsc") === "true", page: Math.max(1, Number(params.get("page")) || 1)
            }, false);
        }
        window.addEventListener("popstate", restoreFromHistory);
        return () => window.removeEventListener("popstate", restoreFromHistory);
    }, []);
    function persistColumns(columns) {
        const preferences = preferenceStoreRef.current?.get?.();
        if (preferences?.account) {
            if (preferences.enabled)
                preferenceStoreRef.current.patch({itemColumns: columns});
            return;
        }
        if (parseCookieHeader(document.cookie)["cookie-consent"] !== "true") return;
        document.cookie = columnsPreferenceCookie(columns);
    }

    async function runSearch(criteria, updateHistory = true) {
        abortRef.current?.abort();
        const controller = new AbortController(); abortRef.current = controller;
        const requestId = requestIdRef.current + 1; requestIdRef.current = requestId;
        dispatch({type: "search/requested", requestId, criteria});
        if (updateHistory) window.history.pushState({}, "", searchUrl(criteria));
        try {
            const next = await loadItems(criteria, state.metadata.statInfo, controller.signal);
            dispatch({type: "search/succeeded", requestId, results: next.items, moreResults: next.moreResults});
        } catch (error) {
            if (error?.name !== "AbortError") dispatch({type: "search/failed", requestId, error: "Search could not be completed. Try again."});
        }
    }
    const visible = stat => state.selectedColumns.includes(stat.short);
    const addHref = props.user ? "/items/add.html" : "/login.html?returnUrl=/items/add.html";
    return <>
        <div className="container-fluid"><div className="px-0"><div className="row"><div className="col-12"><div className="row text-center"><h1 className="col-12">Items</h1></div><div className="px-0 px-md-5">
            {Object.keys(state.nextCriteria.filters).length > 0 && <p className="text-info">Filters: {state.metadata.statInfo.filter(stat => Object.hasOwn(state.nextCriteria.filters, stat.var)).map(stat => <button type="button" key={stat.var} className="badge badge-pill badge-info border-0" onClick={() => dispatch({type: "filter/remove", field: stat.var})}>{stat.display}&nbsp;<i className="fas fa-times" aria-hidden="true" /></button>)}</p>}
            {state.filtersDirty && <p className="text-danger">You have updated your selection of filters. Please search again to apply them.</p>}
            <form onSubmit={event => { event.preventDefault(); runSearch(state.nextCriteria); }}><div className="row"><div className="input-group col-12"><input type="text" className="form-control" placeholder="Search by name..." value={state.nextCriteria.search ?? ""} autoFocus onChange={event => dispatch({type: "search/text", search: event.target.value})} /><div className="input-group-append"><button ref={columnsTriggerRef} className="btn btn-outline-primary" type="button" aria-haspopup="dialog" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(true)}><span className="d-none d-md-inline-block">Columns</span><i className="d-inline-block d-md-none fas fa-columns" /></button><button ref={filtersTriggerRef} className="btn btn-outline-primary" type="button" aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><span className="d-none d-md-inline-block">Filters</span><i className="d-inline-block d-md-none fas fa-filter" /></button><button className="btn btn-primary" type="submit"><span className="d-none d-md-inline-block">{state.status === "pending" ? "Searching…" : "Search"}</span><i className="d-inline-block d-md-none fas fa-search" /></button></div></div></div></form>
        </div><br />
        {state.status === "error" && <p role="alert" className="text-danger">{state.error}</p>}
        <Pagination criteria={state.criteria} moreResults={state.moreResults} resultLength={state.results.length} onNavigate={runSearch} />
        <div className="row"><div className="col-12"><div className="card"><div className="card-header"><strong className="float-left">{state.criteria.search == null && Object.keys(state.criteria.filters).length === 0 ? "Recently Modified" : "Search Results"}</strong><span className="float-right clickable"><a href={addHref} aria-label="Add item"><i className="fas fa-plus" aria-hidden="true" /></a></span></div><div className="table-responsive"><table className="table table-sm table-md table-hover table-striped table-bordered mb-0"><thead className="thead-dark"><tr>{state.metadata.statInfo.filter(visible).map(stat => <th key={stat.short} className="text-center" title={stat.display} noWrap=""><button type="button" className="item-sort-button" aria-label={`Sort by ${stat.display}`} onClick={() => runSearch({...state.criteria, sortBy: stat.var, sortAsc: state.criteria.sortBy === stat.var ? !state.criteria.sortAsc : false, page: 1})}>{stat.short}&nbsp;{state.criteria.sortBy === stat.var ? <i className={`fas fa-sort-${state.criteria.sortAsc ? "up" : "down"}`} aria-hidden="true" /> : !state.criteria.sortBy && <i className="fas fa-sort" aria-hidden="true" />}</button></th>)}</tr></thead><tbody>{state.results.map(item => <tr key={item.id} onClick={event => { if (!event.target.closest("a, button")) window.location.href = `/items/details.html?id=${item.id}`; }} style={{cursor: "pointer"}}>{state.metadata.statInfo.filter(visible).map(stat => <td key={stat.short} className={stat.var === "name" ? "text-primary font-weight-bold text-nowrap" : stat.var === "alignRestriction" ? "text-center text-monospace" : "text-center"}>{stat.var === "name" ? <a href={`/items/details.html?id=${item.id}`}>{item.name}</a> : resultValue(item, stat, state.metadata.constants)}{stat.var === "name" && <a className="float-right" href={`/items/details.html?id=${item.id}`} target="_blank" rel="noreferrer" aria-label={`Open details for ${item.name} in a new tab`}><i className="fas fa-external-link-alt fa-lg" aria-hidden="true" /></a>}</td>)}</tr>)}</tbody></table></div></div></div></div><br />
        <Pagination criteria={state.criteria} moreResults={state.moreResults} resultLength={state.results.length} onNavigate={runSearch} /><br /><br />
        </div></div></div></div>
        <ColumnsDialog categories={state.metadata.categories} open={columnsOpen} onClose={closeColumns} onToggle={short => { const columns = state.selectedColumns.includes(short) ? state.selectedColumns.filter(value => value !== short) : [...state.selectedColumns, short]; persistColumns(columns); dispatch({type: "column/toggle", short}); }} onReset={() => { const columns = state.metadata.statInfo.filter(stat => stat.showColumnDefault).map(stat => stat.short); persistColumns(columns); dispatch({type: "column/reset"}); }} selectedColumns={state.selectedColumns} triggerRef={columnsTriggerRef} />
        <FiltersDialog categories={state.metadata.categories} constants={state.metadata.constants} filters={state.nextCriteria.filters} open={filtersOpen} onClose={closeFilters} onToggle={field => dispatch({type: "filter/toggle", field})} onValue={(field, value) => dispatch({type: "filter/value", field, value})} onReset={() => dispatch({type: "filter/reset"})} triggerRef={filtersTriggerRef} />
    </>;
}
