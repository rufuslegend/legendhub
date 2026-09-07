"use strict";

const {execFile, spawn} = require("node:child_process");
const {once} = require("node:events");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const {promisify} = require("node:util");
const mysql = require("mysql");
const {hash} = require("../../src/routes/api/php-password");

const exec = promisify(execFile);
const repository = path.resolve(__dirname, "../../..");
const image = "mariadb:12.3.3@sha256:dd9b303aed4f4890ed09f766d8ca9ddfd176c0c6f6267feff53b3192ec65a979";
const password = "disposable-mariadb-browser-password";
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function freePort() {
    const server = net.createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}

async function stopApp(child) {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null)
        return;
    const exited = once(child, "exit");
    process.kill(-child.pid, "SIGTERM");
    const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
    if (!stopped) {
        process.kill(-child.pid, "SIGKILL");
        await exited;
    }
}

async function startStack() {
    // Leave a minute before Playwright's fixture timeout for our own cleanup.
    const startupDeadline = Date.now() + 240_000;
    let started = false;
    function timeout(maximum) {
        const remaining = started ? maximum : Math.min(maximum, startupDeadline - Date.now());
        if (remaining <= 0)
            throw new Error("Disposable MariaDB/browser stack exceeded its startup deadline");
        return remaining;
    }
    const name = `legendhub-builder-e2e-${process.pid}-${Date.now()}`;
    const workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "legendhub-builder-e2e-"));
    let containerStarted = false;
    let pool;
    let child;
    let appOutput = "";
    const query = (sql, values = []) => new Promise((resolve, reject) => {
        pool.query({sql, timeout: timeout(5000)}, values, (error, rows) => error ? reject(error) : resolve(rows));
    });
    async function close() {
        try {
            await stopApp(child);
        }
        finally {
            try {
                if (pool)
                    await new Promise(resolve => pool.end(resolve));
            }
            finally {
                try {
                    if (containerStarted) {
                        try {
                            await exec("docker", ["rm", "--force", "--volumes", name], {timeout: 15_000});
                        }
                        catch (error) {
                            if (!error.stderr?.includes("No such container"))
                                throw error;
                        }
                    }
                }
                finally {
                    await fs.rm(workingDirectory, {recursive: true, force: true});
                }
            }
        }
    }

    try {
        // docker run can time out after creating the container; always attempt
        // removal by its unique name, even when the command does not succeed.
        containerStarted = true;
        await exec("docker", [
            "run", "--detach", "--rm", "--platform", "linux/amd64",
            "--name", name,
            "--env", `MARIADB_ROOT_PASSWORD=${password}`,
            "--publish", "127.0.0.1::3306",
            "--tmpfs", "/var/lib/mysql:rw",
            "--volume", `${path.join(repository, "mysql/mariadb-conf")}:/etc/mysql/conf.d:ro`,
            image
        ], {timeout: timeout(120_000)});
        const published = await exec("docker", ["port", name, "3306/tcp"], {timeout: timeout(10_000)});
        const databasePort = Number(published.stdout.trim().split(":").at(-1));
        const connectionOptions = {
            host: "127.0.0.1", port: databasePort, user: "root", password,
            multipleStatements: true, connectionLimit: 2, connectTimeout: 5000, acquireTimeout: 5000
        };
        pool = mysql.createPool(connectionOptions);
        let ready = false;
        const databaseDeadline = Math.min(startupDeadline, Date.now() + 90_000);
        while (Date.now() < databaseDeadline) {
            try {
                await query("SELECT 1");
                ready = true;
                break;
            }
            catch {
                await delay(1000);
            }
        }
        if (!ready)
            throw new Error("Disposable MariaDB did not become ready within 90 seconds");
        // The legacy Items metadata lookup expects this name. Isolation comes
        // from a new container, never a caller-provided database connection.
        await query("CREATE DATABASE legendhub CHARACTER SET latin1 COLLATE latin1_swedish_ci");
        await new Promise(resolve => pool.end(resolve));
        pool = mysql.createPool({...connectionOptions, database: "legendhub"});
        await query(await fs.readFile(path.join(__dirname, "builder-baseline.sql"), "utf8"));
        const fixturePassword = hash("disposable-builder-password");
        for (const [index, username] of ["BuilderTester", "IsolationOwner", "IsolationOther"].entries()) {
            await query("INSERT INTO Members (Id, Username, Password) VALUES (?, ?, ?)",
                [index + 1, username, fixturePassword]);
        }
        await query("CREATE USER 'builder_app'@'%' IDENTIFIED BY ?", [password]);
        await query("GRANT ALL ON legendhub.* TO 'builder_app'@'%'");

        const port = await freePort();
        const url = `http://localhost:${port}`;
        async function launchApp() {
            appOutput = "";
            child = spawn(process.execPath, [path.join(repository, "www/src/app.js")], {
                cwd: workingDirectory,
                detached: true,
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                    PATH: process.env.PATH,
                    NODE_ENV: "test",
                    PORT: String(port),
                    MYSQL_HOST: "127.0.0.1", MYSQL_PORT: String(databasePort),
                    MYSQL_DATABASE: "legendhub", MYSQL_USER: "builder_app", MYSQL_PASSWORD: password,
                    APP_BASE_URL: url,
                    npm_package_version: require("../../package.json").version
                }
            });
            let spawnError;
            child.on("error", error => { spawnError = error; });
            const collect = chunk => { appOutput = (appOutput + chunk.toString()).slice(-12_000); };
            child.stdout.on("data", collect);
            child.stderr.on("data", collect);
            const appDeadline = Math.min(started ? Infinity : startupDeadline, Date.now() + 30_000);
            while (Date.now() < appDeadline) {
                if (spawnError || child.exitCode !== null || child.signalCode !== null)
                    throw new Error(`Application failed to start: ${spawnError?.message || ""}\n${appOutput}`);
                try {
                    const response = await fetch(`${url}/builder/`, {signal: AbortSignal.timeout(1000)});
                    if (response.ok && (await response.text()).includes('data-react-props="builder"'))
                        return;
                }
                catch { /* Wait for the actual app and migrations to finish. */ }
                await delay(100);
            }
            throw new Error(`Application did not become ready\n${appOutput}`);
        }
        await launchApp();
        await query("UPDATE Members SET Email = CONCAT(Username, '@example.test'), " +
            "NormalizedEmail = LOWER(CONCAT(Username, '@example.test')), EmailVerifiedOn = NOW()");
        started = true;
        return {
            url, query, close,
            async restartApp() {
                await stopApp(child);
                await launchApp();
            },
            get output() { return appOutput; }
        };
    }
    catch (error) {
        try {
            await close();
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], "Browser stack startup and cleanup failed");
        }
        throw error;
    }
}

module.exports = {startStack};
