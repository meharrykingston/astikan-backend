"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("@fastify/cors"));
const corsPlugin = async (app) => {
    await app.register(cors_1.default, {
        origin: true,
    });
};
exports.default = corsPlugin;
//# sourceMappingURL=cors.js.map