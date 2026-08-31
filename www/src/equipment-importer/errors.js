"use strict";

class ImportValidationError extends Error {
    constructor(code, message, paths = []) {
        super(message);
        this.name = "ImportValidationError";
        this.code = code;
        this.paths = paths;
    }
}

module.exports = {ImportValidationError};
