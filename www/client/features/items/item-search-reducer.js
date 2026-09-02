import {equipmentDisplayPreferences} from "../../lib/equipment-display-preferences.js";

function parseFilters(filterString) {
    if (!filterString)
        return {};
    return filterString.split(",").reduce(function(filters, filter) {
        const [field, ...values] = filter.split("_");
        if (field)
            filters[field] = values;
        return filters;
    }, {});
}

function cloneFilters(filters) {
    return Object.fromEntries(Object.entries(filters).map(function([field, values]) {
        return [field, [...values]];
    }));
}

function defaultColumns(statInfo) {
    return statInfo.filter(stat => stat.showColumnDefault).map(stat => stat.short);
}

function withCriteria(state, nextCriteria) {
    return {...state, nextCriteria};
}

export function columnsCookie(columns) {
    return columns.join("-");
}

export function searchUrl(criteria) {
    const query = [];
    const filters = Object.entries(criteria.filters).map(function([field, values]) {
        return [field, ...values].join("_");
    }).join(",");
    if (filters)
        query.push(`filters=${encodeURIComponent(filters).replace(/%2C/gi, ",")}`);
    if (criteria.search != null)
        query.push(`search=${encodeURIComponent(criteria.search).replace(/%20/g, "+")}`);
    if (criteria.sortBy)
        query.push(`sortBy=${encodeURIComponent(criteria.sortBy)}`);
    if (criteria.sortBy)
        query.push(`sortAsc=${Boolean(criteria.sortAsc)}`);
    if (criteria.page > 1)
        query.push(`page=${criteria.page}`);
    return `/items/index.html?${query.join("&")}`;
}

export function createInitialItemSearchState(props) {
    const query = props.query || {};
    const criteria = {
        search: Object.hasOwn(query, "search") ? query.search : null,
        filters: parseFilters(query.filters),
        sortBy: query.sortBy || null,
        sortAsc: query.sortAsc === "true",
        page: Math.max(1, Number(query.page) || 1)
    };
    const accountColumns = props.accountPreferences?.account === true &&
        Array.isArray(props.accountPreferences.document?.itemColumns)
        ? props.accountPreferences.document.itemColumns
        : null;
    return {
        criteria,
        nextCriteria: criteria,
        error: null,
        filtersDirty: false,
        metadata: {
            categories: props.categories || [],
            constants: props.constants || {selectShortOptions: {}},
            statInfo: props.statInfo || []
        },
        moreResults: Boolean(props.moreResults),
        equipmentPreferences: equipmentDisplayPreferences(props.accountPreferences),
        requestId: 0,
        results: props.results || [],
        selectedColumns: [...(accountColumns || props.selectedColumns || defaultColumns(props.statInfo || []))],
        status: "idle"
    };
}

export function itemSearchReducer(state, action) {
    switch (action.type) {
        case "search/text":
            return withCriteria(state, {...state.nextCriteria, search: action.search, page: 1});
        case "filter/toggle": {
            const filters = cloneFilters(state.nextCriteria.filters);
            if (Object.hasOwn(filters, action.field))
                delete filters[action.field];
            else
                filters[action.field] = [];
            return withCriteria({...state, filtersDirty: true}, {...state.nextCriteria, filters, page: 1});
        }
        case "filter/value": {
            const filters = cloneFilters(state.nextCriteria.filters);
            if (action.value === "")
                delete filters[action.field];
            else
                filters[action.field] = [action.value];
            return withCriteria({...state, filtersDirty: true}, {...state.nextCriteria, filters, page: 1});
        }
        case "filter/remove": {
            const filters = cloneFilters(state.nextCriteria.filters);
            delete filters[action.field];
            return withCriteria({...state, filtersDirty: true}, {...state.nextCriteria, filters, page: 1});
        }
        case "filter/reset":
            return withCriteria({...state, filtersDirty: true}, {...state.nextCriteria, filters: {}, page: 1});
        case "sort/change": {
            const repeat = state.criteria.sortBy === action.sortBy;
            return withCriteria(state, {
                ...state.criteria,
                sortBy: action.sortBy,
                sortAsc: repeat ? !state.criteria.sortAsc : false,
                page: 1
            });
        }
        case "page/change":
            return withCriteria(state, {...state.criteria, page: Math.max(1, action.page)});
        case "column/toggle": {
            const selectedColumns = state.selectedColumns.includes(action.short)
                ? state.selectedColumns.filter(short => short !== action.short)
                : [...state.selectedColumns, action.short];
            return {...state, selectedColumns};
        }
        case "column/reset":
            return {...state, selectedColumns: defaultColumns(state.metadata.statInfo)};
        case "search/requested":
            return {
                ...state,
                criteria: action.criteria,
                nextCriteria: action.criteria,
                error: null,
                filtersDirty: false,
                requestId: action.requestId,
                status: "pending"
            };
        case "search/succeeded":
            if (action.requestId !== state.requestId)
                return state;
            return {...state, moreResults: action.moreResults, results: action.results, status: "idle"};
        case "search/failed":
            if (action.requestId !== state.requestId)
                return state;
            return {...state, error: action.error, status: "error"};
        default:
            return state;
    }
}

export function categoryStacks(categories) {
    const configured = [["Basic"], ["Main", "Limits", "Ranged"], ["Regen", "Tank", "Melee"], ["Mage", "Weapon"]];
    const known = new Set(configured.flat());
    const byName = new Map(categories.filter(category => known.has(category.name)).map(category => [category.name, category]));
    return [
        ...configured.map(stack => stack.map(name => byName.get(name)).filter(Boolean)).filter(stack => stack.length),
        ...categories.filter(category => !known.has(category.name)).map(category => [category])
    ];
}
