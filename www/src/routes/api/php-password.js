const bcrypt = require("bcryptjs");

const DEFAULT_COST = 10;

module.exports.hash = function(password) {
    return bcrypt.hashSync(password, DEFAULT_COST).replace(/^\$2[ab]\$/, "$2y$");
};

module.exports.verify = function(password, hash) {
    const compatibleHash = hash.replace(/^\$2[xy]\$/, "$2a$");
    return bcrypt.compareSync(password, compatibleHash);
};
