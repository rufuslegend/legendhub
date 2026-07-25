require("dotenv").config();

const migrations = require("./routes/api/migrations");

async function start(options = {}) {
    const migrate = options.migrate || migrations.up;
    const port = options.port === undefined ? process.env.PORT : options.port;
    const log = options.log || console.log;

    await migrate();

    const createApplication = options.createApplication || require("./create-app");
    const app = createApplication();
    return app.listen(port, () => log(`Running app listening on port ${port}!`));
}

async function main(options = {}) {
    const closeDatabase = options.closeDatabase || migrations.close;
    const logError = options.logError || console.error;

    try {
        return await start(options);
    }
    catch (error) {
        logError("Application startup failed:", error);

        try {
            await closeDatabase();
        }
        catch (closeError) {
            logError("Failed to close the database pool:", closeError);
        }

        process.exitCode = 1;
        return undefined;
    }
}

if (require.main === module)
    main();

exports.main = main;
exports.start = start;
