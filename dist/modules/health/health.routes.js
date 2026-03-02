"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = healthRoutes;
async function healthRoutes(app) {
    app.get("/", async () => {
        return { status: "ok", service: "Astikan backend" };
    });
}
//# sourceMappingURL=health.routes.js.map