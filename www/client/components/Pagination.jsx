import {searchUrl} from "../features/items/item-search-reducer.js";

export default function Pagination({criteria, moreResults, resultLength, onNavigate}) {
    const first = {...criteria, page: 1};
    const previous = {...criteria, page: Math.max(1, criteria.page - 1)};
    const next = {...criteria, page: criteria.page + 1};
    function link(label, target, disabled, icon) { return <li className={`page-item${disabled ? " disabled" : ""}`}>{disabled ? <span className="page-link" aria-label={label}><span aria-hidden="true"><i className={icon} /></span><span className="sr-only">{label[0].toUpperCase() + label.slice(1)}</span></span> : <a href={searchUrl(target)} className="page-link" aria-label={label} onClick={event => { event.preventDefault(); onNavigate(target); }}><span aria-hidden="true"><i className={icon} /></span><span className="sr-only">{label[0].toUpperCase() + label.slice(1)}</span></a>}</li>; }
    return <div className="row"><nav className="col" aria-label="Result navigation"><ul className="pagination">{link("first", first, criteria.page === 1, "fas fa-angle-double-left")}{link("previous", previous, criteria.page === 1, "fas fa-angle-left")}{link("next", next, !moreResults, "fas fa-angle-right")}<li className="page-item disabled"><span className="page-link">Results: {20 * (criteria.page - 1) + 1} - {20 * (criteria.page - 1) + resultLength}</span></li></ul></nav></div>;
}
