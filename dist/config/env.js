"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.envSchema = void 0;
exports.envSchema = {
    type: "object",
    required: ["PORT"],
    properties: {
        PORT: { type: "string", default: "3000" },
    },
};
//# sourceMappingURL=env.js.map