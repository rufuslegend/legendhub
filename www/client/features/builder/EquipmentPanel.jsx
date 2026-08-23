import {
  CHARM_OPTIONS,
  RUNE_CHARM_ID,
  SELECT_SHORT_OPTIONS,
  SLOT_LABELS,
} from "./item-constants.js";
import { getItemRestrictionText } from "./builder-derivations.js";
import { BuilderModal } from "./ImportExportDialog.jsx";
import { selectFilteredItems } from "./builder-reducer.js";

function visibleStats(state) {
  return state.statInfo.filter(
    (stat) => stat.showColumn && stat.var !== "name" && stat.var !== "slot",
  );
}

function sortItems(items, stat, direction) {
  if (!stat) return items;
  return items.slice().sort((left, right) => {
    const a =
      typeof left[stat] === "string" ? left[stat].toUpperCase() : left[stat];
    const b =
      typeof right[stat] === "string" ? right[stat].toUpperCase() : right[stat];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    return (a < b ? -1 : a > b ? 1 : 0) * (direction === "-" ? -1 : 1);
  });
}

function displayValue(item, stat) {
  if (stat.type === "bool")
    return (
      <i
        className={
          Number(item[stat.var]) === 1
            ? "text-success fas fa-check"
            : "text-danger fas fa-times"
        }
        aria-label={Number(item[stat.var]) === 1 ? "yes" : "no"}
      />
    );
  if (stat.type === "select")
    return (
      <span
        className={stat.var === "alignRestriction" ? "text-monospace" : ""}
        style={
          stat.var === "alignRestriction" ? { whiteSpace: "pre" } : undefined
        }
      >
        {SELECT_SHORT_OPTIONS[stat.var]?.[item[stat.var]] ??
          item[stat.var] ??
          ""}
      </span>
    );
  return <span>{item[stat.var] ?? ""}</span>;
}

function statRestrictionText(restrictions = []) {
  return restrictions
    .map((restriction) => {
      if (
        ["fromItems", "fromTotalMin", "fromTotalMax"].includes(
          restriction.restriction,
        )
      )
        return `The ${restriction.restriction === "fromItems" ? "item" : "overall"} limit for this stat is ${restriction.limit}. You currently have ${restriction.amount}.`;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function DetailsLink({ item }) {
  return item.id > 0 ? (
    <a
      className="float-right"
      href={`/items/details.html?id=${item.id}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open details for ${item.name} in a new tab`}
      onClick={(event) => event.stopPropagation()}
    >
      <i className="fas fa-external-link-alt fa-lg" aria-hidden="true" />
    </a>
  ) : null;
}

export default function EquipmentPanel({
  state,
  totals,
  restrictions,
  statRestrictions,
  onAction,
  onOpen,
  onPick,
  onClose,
}) {
  const stats = visibleStats(state);
  const current = state.currentItem;
  const filtered = sortItems(
    selectFilteredItems(state) || [],
    state.sortStat,
    state.sortDir,
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / state.itemsPerPage),
  );
  const page = Math.min(state.currentPage, totalPages);
  const choices = filtered.slice(
    (page - 1) * state.itemsPerPage,
    page * state.itemsPerPage,
  );
  const sortLabel = (stat) =>
    state.sortStat !== stat
      ? ""
      : state.sortDir === "+"
        ? " ascending"
        : " descending";
  const changePage = (nextPage) =>
    onAction({
      type: "ui/patch",
      value: { currentPage: Math.min(Math.max(nextPage, 1), totalPages) },
    });
  return (
    <section className="row">
      <div className="table-responsive">
        <table className="table table-striped table-hover table-sm table-bordered">
          <thead className="thead-dark">
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Lock</th>
              <th scope="col">Name</th>
              {stats.map((stat) => (
                <th key={stat.var} title={stat.display}>
                  {stat.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-secondary text-white">
              <td />
              <td>
                <button
                  type="button"
                  className="btn btn-link p-0"
                  aria-label="Toggle all item locks"
                  onClick={() => onAction({ type: "items/toggle-lock" })}
                >
                  Lock
                </button>
              </td>
              <td>Total</td>
              {stats.map((stat) => (
                <td
                  key={stat.var}
                  className={
                    statRestrictions[stat.var]?.length ? "bg-danger" : ""
                  }
                  aria-describedby={
                    statRestrictions[stat.var]?.length
                      ? `builder-stat-warning-${stat.var}`
                      : undefined
                  }
                >
                  {totals[stat.var] ?? ""}
                  {statRestrictions[stat.var]?.length > 0 && (
                    <span
                      id={`builder-stat-warning-${stat.var}`}
                      className="d-block small"
                      role="alert"
                    >
                      {statRestrictionText(statRestrictions[stat.var])}
                    </span>
                  )}
                </td>
              ))}
            </tr>
            {state.selectedList.items.map((item, index) => {
              const warning = getItemRestrictionText(
                restrictions[index],
                item,
              ).replaceAll("<br /><br />", " ");
              return (
                <tr key={index}>
                  <td
                    className={
                      warning ? "bg-danger text-white" : "bg-primary text-white"
                    }
                    aria-describedby={
                      warning ? `builder-item-warning-${index}` : undefined
                    }
                  >
                    {SLOT_LABELS[item.slot] || item.slot}
                    {warning && (
                      <span
                        id={`builder-item-warning-${index}`}
                        className="d-block small"
                        role="alert"
                      >
                        {warning}
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link p-0"
                      aria-label={`Toggle lock for ${SLOT_LABELS[item.slot] || `slot ${index + 1}`}`}
                      onClick={() =>
                        onAction({ type: "item/toggle-lock", index })
                      }
                    >
                      {item.locked ? "Locked" : "Unlocked"}
                    </button>
                  </td>
                  <th scope="row">
                    <button
                      type="button"
                      className="btn btn-link p-0"
                      onClick={() => onOpen(index)}
                    >
                      {item.name || "-"}
                    </button>
                    <DetailsLink item={item} />
                  </th>
                  {stats.map((stat) => (
                    <td key={stat.var} onClick={() => onOpen(index)}>
                      {displayValue(item, stat)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {current && (
        <BuilderModal
          label="Choose Item"
          onClose={onClose}
          initialFocus="#itemChoiceSearch"
        >
          <div className="modal-body">
            <div className="card mb-3">
              <h3 className="h5 m-3">Current Item and Stats</h3>
              <div className="table-responsive">
                <table className="table table-sm mb-0">
                  <thead className="thead-dark">
                    <tr>
                      <th>Slot</th>
                      <th>Lock</th>
                      <th>Name</th>
                      {stats.map((stat) => (
                        <th key={stat.var}>{stat.short}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{SLOT_LABELS[current.slot] || current.slot}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-link p-0"
                          aria-label={`${current.locked ? "Unlock" : "Lock"} current item`}
                          onClick={() =>
                            onAction({ type: "search/toggle-lock" })
                          }
                        >
                          {current.locked ? "Locked" : "Unlocked"}
                        </button>
                      </td>
                      <th>
                        {current.name}
                        <DetailsLink item={current} />
                      </th>
                      {stats.map((stat) => (
                        <td key={stat.var}>{displayValue(current, stat)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <label htmlFor="itemChoiceSearch">Search items</label>
            <input
              id="itemChoiceSearch"
              className="form-control"
              placeholder="Search…"
              value={state.searchString}
              onChange={(event) =>
                onAction({ type: "search/text", value: event.target.value })
              }
            />
            {(current.slot === 14 || current.slot === 15) && (
              <label className="d-block mt-3" htmlFor="wield-slot-filter">
                Slot Filter
                <select
                  id="wield-slot-filter"
                  className="custom-select"
                  value={state.wieldSlotFilter}
                  onChange={(event) =>
                    onAction({
                      type: "search/wield",
                      value: Number(event.target.value),
                    })
                  }
                >
                  <option value="0">Wield, Hold, &amp; Shield slots</option>
                  <option value="1">Wield slot only</option>
                  <option value="2">Hold slot only</option>
                  <option value="3">Shield slot only</option>
                </select>
              </label>
            )}
            {(current.slot === 13 || current.slot === 2) && (
              <button
                type="button"
                className="btn btn-primary mt-3"
                onClick={() => onAction({ type: "rune/toggle-mode" })}
              >
                {state.isRuneCrafting ? "Items" : "Runecraft Customizer"}
              </button>
            )}
            {state.isRuneCrafting ? (
              <div className="mt-3">
                {state.charmSelectors.map((selection, index) => (
                  <select
                    className="custom-select mb-2"
                    aria-label={`Rune charm ${index + 1}`}
                    value={selection}
                    key={index}
                    onChange={(event) => {
                      const charmSelectors = state.charmSelectors.slice();
                      charmSelectors[index] = event.target.value;
                      onAction({ type: "ui/patch", value: { charmSelectors } });
                    }}
                  >
                    <option value="A">--Select--</option>
                    {Object.values(CHARM_OPTIONS).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ))}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    onPick(
                      {
                        id: RUNE_CHARM_ID,
                        slot: current.slot,
                        name: "Runecharm",
                      },
                      true,
                    )
                  }
                >
                  Save Runecharm
                </button>
              </div>
            ) : (
              <>
                <table className="table table-sm mt-3">
                  <thead className="thead-dark">
                    <tr>
                      <th>
                        <button
                          className="btn btn-link p-0 text-white"
                          type="button"
                          onClick={() =>
                            onAction({ type: "search/sort", stat: "name" })
                          }
                        >
                          Name{sortLabel("name")}
                        </button>
                      </th>
                      {stats.map((stat) => (
                        <th key={stat.var}>
                          <button
                            className="btn btn-link p-0 text-white"
                            type="button"
                            onClick={() =>
                              onAction({ type: "search/sort", stat: stat.var })
                            }
                          >
                            {stat.short}
                            {sortLabel(stat.var)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {choices.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <button
                            className="btn btn-link p-0"
                            type="button"
                            disabled={current.locked}
                            onClick={() => onPick(item)}
                          >
                            {item.name}
                          </button>
                          <DetailsLink item={item} />
                        </td>
                        {stats.map((stat) => (
                          <td key={stat.var}>{displayValue(item, stat)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <nav aria-label="Item result navigation">
                    <ul className="pagination">
                      <li className="page-item">
                        <button
                          className="page-link"
                          type="button"
                          aria-label="Previous"
                          disabled={page === 1}
                          onClick={() => changePage(page - 1)}
                        >
                          Previous
                        </button>
                      </li>
                      {Array.from({ length: totalPages }, (_, index) => (
                        <li
                          className={`page-item ${page === index + 1 ? "active" : ""}`}
                          key={index}
                        >
                          <button
                            className="page-link"
                            type="button"
                            aria-current={
                              page === index + 1 ? "page" : undefined
                            }
                            onClick={() => changePage(index + 1)}
                          >
                            {index + 1}
                          </button>
                        </li>
                      ))}
                      <li className="page-item">
                        <button
                          className="page-link"
                          type="button"
                          aria-label="Next"
                          disabled={page === totalPages}
                          onClick={() => changePage(page + 1)}
                        >
                          Next
                        </button>
                      </li>
                    </ul>
                  </nav>
                )}
              </>
            )}
          </div>
        </BuilderModal>
      )}
    </section>
  );
}
