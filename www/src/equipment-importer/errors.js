"use strict";

class ImportValidationError extends Error {
    constructor(code, message, paths = []) {
        super(message);
        this.name = "ImportValidationError";
        this.code = code;
        this.paths = paths;
    }
}

class EquipmentImportError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "EquipmentImportError";
        this.code = code;
        this.paths = [];
    }
}

module.exports = {EquipmentImportError, ImportValidationError};
