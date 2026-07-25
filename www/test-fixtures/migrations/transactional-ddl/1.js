exports.mode = "transactional";

exports.up = function() {
    return "ALTER TABLE MigrationTest ADD COLUMN UnsafeValue INT";
};
