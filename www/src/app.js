require("dotenv").config();

const migrations = require("./routes/api/migrations");
migrations.up();

const createApp = require("./create-app");
const app = createApp();

app.listen(process.env.PORT, () => console.log(`Running app listening on port ${process.env.PORT}!`));
