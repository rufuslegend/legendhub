import {ATTRIBUTE_NAMES} from "./item-constants.js";
import QuestModifiersPanel from "./QuestModifiersPanel.jsx";
import EraAbilitiesPanel from "./EraAbilitiesPanel.jsx";

const labels = {strength: "Str", mind: "Min", dexterity: "Dex", constitution: "Con", perception: "Per", spirit: "Spi"};

export default function StatsPanel({state, onAction}) {
    const selected = state.selectedList;
    const total = ATTRIBUTE_NAMES.reduce((sum, stat) => sum + Number(selected.baseStats[stat] || 0), 0);
    function change(section, stat, value) { onAction({type: "stat/change", section, stat, value}); }
    return <section className="col-lg-6 col-12 mb-4" aria-labelledby="builder-stats-heading"><div className="card border-primary h-100"><div className="card-header py-2"><h1 className="h4 mb-0" id="builder-stats-heading">Stats</h1></div><div className="card-body pb-3 px-3 pt-2"><p className="h5 my-0">Base</p><div className="row">{ATTRIBUTE_NAMES.map(stat => <div className="col-4 col-sm-2 text-center" key={stat}><label className="col-form-label col-form-label-sm" htmlFor={`${stat === "strength" ? "str" : stat.slice(0, 3)}Input`}>{labels[stat]}</label><input type="number" id={`${stat === "strength" ? "str" : stat.slice(0, 3)}Input`} className="form-control form-control-sm" value={selected.baseStats[stat]} onChange={event => change("baseStats", stat, Number(event.target.value))} /></div>)}</div>{total !== 198 && total !== 244 && <p className="text-danger">Base stats should add up to either 198 or 244.</p>}<QuestModifiersPanel collapsed={!state.ksmOpen} onCollapsed={() => onAction({type: "ui/patch", value: {ksmOpen: !state.ksmOpen}})} selectedList={selected} onStat={change} /><EraAbilitiesPanel collapsed={!state.eraOpen} onCollapsed={() => onAction({type: "ui/patch", value: {eraOpen: !state.eraOpen}})} selectedList={selected} onStat={change} /></div></div></section>;
}
