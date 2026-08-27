"use strict";

function query(executor, sql, values = []) {
    return new Promise(function(resolve, reject) {
        executor.query(sql, values, function(error, results) {
            if (error)
                reject(error);
            else
                resolve(results);
        });
    });
}

function getConnection(pool) {
    return new Promise(function(resolve, reject) {
        pool.getConnection(function(error, connection) {
            if (error)
                reject(error);
            else
                resolve(connection);
        });
    });
}

function runConnectionMethod(connection, method) {
    return new Promise(function(resolve, reject) {
        connection[method](function(error) {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}

async function withTransaction(pool, operation) {
    const connection = await getConnection(pool);
    let result;
    let transactionError;

    try {
        await runConnectionMethod(connection, "beginTransaction");
        try {
            result = await operation(connection);
            await runConnectionMethod(connection, "commit");
        }
        catch (operationError) {
            try {
                await runConnectionMethod(connection, "rollback");
            }
            catch (rollbackError) {
                throw new AggregateError(
                    [operationError, rollbackError],
                    "Transaction failed and could not be rolled back"
                );
            }
            throw operationError;
        }
    }
    catch (error) {
        transactionError = error;
    }
    finally {
        try {
            connection.release();
        }
        catch (releaseError) {
            if (transactionError) {
                const errors = transactionError instanceof AggregateError
                    ? [...transactionError.errors, releaseError]
                    : [transactionError, releaseError];
                throw new AggregateError(
                    errors,
                    "Transaction failed and the connection could not be released"
                );
            }
            throw releaseError;
        }
    }

    if (transactionError)
        throw transactionError;
    return result;
}

module.exports = {query, withTransaction};
