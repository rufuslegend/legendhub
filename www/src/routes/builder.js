let express = require("express");
let router = express.Router();
let apiUtils = require("./api/utils");

function createAccountContext(user) {
    const authenticated = Boolean(user);
    const emailVerified = Boolean(user?.emailVerified);
    const canUseAccountStorage = Boolean(emailVerified && user?.canUseAccountStorage);
    return {
        authenticated,
        emailVerified,
        canUseAccountStorage,
        storageNamespace: canUseAccountStorage ? user.storageNamespace || null : null
    };
}

router.get(["/", "/index.html"], async function(req, res, next) {
    let query = `
    {
        getItemStatCategories {
            name
            getItemStatInfo {
                display
                short
                var
                type
                filterString
                showColumnDefault
            }
        }
        getItemStatInfo {
            display
            short
            var
            type
            filterString
            showColumnDefault
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(query);
    }
    catch (e) {
        return next(e);
    }

    let statInfo = data.getItemStatInfo;
    let selectedColumns = [];
    if (req.cookies.sc2) {
        selectedColumns = req.cookies.sc2.split('-');
    }
    else {
        for (let i = 0; i < statInfo.length; ++i) {
            if (statInfo[i].showColumnDefault) {
                selectedColumns.push(statInfo[i].short);
            }
        }
    }

    let vm = {
        itemStatCategories: data.getItemStatCategories,
        selectedColumns: selectedColumns,
        accountContext: createAccountContext(res.locals.user)
    };
    res.render("builder/index", {title: "Builder", vm});
});

module.exports = router;
module.exports.createAccountContext = createAccountContext;
