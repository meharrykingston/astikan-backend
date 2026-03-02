"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const app = (0, app_1.buildApp)();
const start = async () => {
    try {
        await app.listen({ port: 4000, host: "0.0.0.0" });
        console.log("🚀 Backend running on http://localhost:4000");
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=server.js.map