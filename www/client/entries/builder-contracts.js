import * as encoding from "../features/builder/builder-encoding.js";
import * as persistence from "../features/builder/builder-persistence.js";
import * as reducer from "../features/builder/builder-reducer.js";
import * as constants from "../features/builder/item-constants.js";

globalThis.legendBuilderContracts = Object.freeze({
    ...encoding,
    ...persistence,
    ...reducer,
    ...constants
});
