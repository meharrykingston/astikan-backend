"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const routes_1 = __importDefault(require("./routes"));
function buildApp() {
    const app = (0, fastify_1.default)({
        logger: true
    });
    app.register(cors_1.default, {
        origin: ["http://localhost:5173"], // Vite default
        credentials: true
    });
    app.register(routes_1.default, { prefix: "/api" });
    return app;
}
//# sourceMappingURL=app.js.map