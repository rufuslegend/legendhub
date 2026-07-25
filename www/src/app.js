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

if (require.main === module) {
    start().catch(function(error) {
        console.error("Application startup failed:", error);
        process.exitCode = 1;
    });
}

exports.start = start;
