"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = routes;
const health_routes_1 = __importDefault(require("./modules/health/health.routes"));
const lab_routes_1 = __importDefault(require("./modules/lab/lab.routes"));
async function routes(app) {
    app.register(health_routes_1.default, { prefix: "/health" });
    app.register(lab_routes_1.default, { prefix: "/lab" });
}
//# sourceMappingURL=routes.js.map