import {ATTRIBUTE_NAMES} from "./item-constants.js";
import QuestModifiersPanel from "./QuestModifiersPanel.jsx";
import EraAbilitiesPanel from "./EraAbilitiesPanel.jsx";
import {useEffect, useRef} from "react";

const labels = {strength: "Str", mind: "Min", dexterity: "Dex", constitution: "Con", perception: "Per", spirit: "Spi"};
const statQuestHelp = {
    strength: "...has been rewarded for aiding a goddess!",
    mind: "...is smarter than the average Cyclops!",
    dexterity: "...has bested the tricks and traps on the island of Circe!",
    constitution: "...has ventured into the Realm of the Dead and returned to tell the tale!",
    perception: "...drank the nectar of the Black Lotus and lived to tell the tale!",
    spirit: "...has learned of the art and spirit of music."
};

function StatQuestBonus({stat}) {
    const ref = useRef(null);
    const help = statQuestHelp[stat];
    useEffect(() => {
        const jquery = globalThis.jQuery || globalThis.$;
        if (!ref.current || !jquery?.fn?.tooltip) return undefined;
        const element = ref.current;
        jquery(element).tooltip({container: "body", placement: "bottom", trigger: "hover focus"});
        return () => jquery(element).tooltip("dispose");
    }, []);
    return <span ref={ref} className="builder-stat-quest-bonus" tabIndex="0" aria-label={help} title={help}>3&nbsp;<i className="far fa-question-circle" aria-hidden="true" /></span>;
}

export default function StatsPanel({state, onAction}) {
    const selected = state.selectedList;
    const total = ATTRIBUTE_NAMES.reduce((sum, stat) => sum + Number(selected.baseStats[stat] || 0), 0);
    function change(section, stat, value) { onAction({type: "stat/change", section, stat, value}); }
    return <section className="col-lg-6 col-12 mb-4" aria-labelledby="builder-stats-heading"><div className="card border-primary h-100"><div className="card-header py-2"><h1 className="h4 mb-0" id="builder-stats-heading">Stats</h1></div><div className="card-body pb-3 px-3 pt-2"><p className="h5 my-0">Base</p><div className="row">{ATTRIBUTE_NAMES.map(stat => <div className="col-4 col-sm-2 text-center" key={stat}><label className="col-form-label col-form-label-sm" htmlFor={`${stat === "strength" ? "str" : stat.slice(0, 3)}Input`}>{labels[stat]}</label><input type="number" id={`${stat === "strength" ? "str" : stat.slice(0, 3)}Input`} className="form-control form-control-sm" value={selected.baseStats[stat]} onChange={event => change("baseStats", stat, Number(event.target.value))} />{total < 244 && <StatQuestBonus stat={stat} />}</div>)}</div>{total !== 198 && total !== 244 && <p className="text-danger">Base stats should add up to either 198 or 244.</p>}<QuestModifiersPanel collapsed={!state.ksmOpen} onCollapsed={() => onAction({type: "ui/patch", value: {ksmOpen: !state.ksmOpen}})} selectedList={selected} onStat={change} /><EraAbilitiesPanel collapsed={!state.eraOpen} onCollapsed={() => onAction({type: "ui/patch", value: {eraOpen: !state.eraOpen}})} selectedList={selected} onStat={change} /></div></div></section>;
}
