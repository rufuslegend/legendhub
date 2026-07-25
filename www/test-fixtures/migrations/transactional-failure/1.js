exports.mode = "transactional";

exports.up = function() {
    return "UPDATE MigrationTest SET Value = 1";
};
