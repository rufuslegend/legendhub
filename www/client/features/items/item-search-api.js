import {graphqlRequest} from "../../lib/graphql-request.js";

function filterString(filters) {
    return Object.entries(filters).map(function([field, values]) {
        return [field, ...values].join("_");
    }).join(",");
}

export async function loadItems(criteria, statInfo, signal) {
    const fields = [...new Set(["id", ...statInfo.map(stat => stat.var)])].join(" ");
    const data = await graphqlRequest({
        query: `query ItemSearch($searchString: String, $filterString: String, $sortBy: String, $sortAsc: Boolean, $page: Int!, $rows: Int!) {
            getItems(searchString: $searchString, filterString: $filterString, sortBy: $sortBy, sortAsc: $sortAsc, page: $page, rows: $rows) {
                moreResults
                items { ${fields} }
            }
        }`,
        variables: {
            searchString: criteria.search == null ? null : criteria.search,
            filterString: filterString(criteria.filters) || null,
            sortBy: criteria.sortBy,
            sortAsc: criteria.sortBy ? criteria.sortAsc : null,
            page: criteria.page,
            rows: 20
        },
        signal
    });
    return data.getItems;
}
